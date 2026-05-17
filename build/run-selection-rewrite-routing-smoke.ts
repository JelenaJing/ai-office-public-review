import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

type DocumentEngineId = 'legacy-tiptap-bridge' | 'embedded-office-engine'

type WorkspaceInfo = {
  name: string
  path: string
  hasDocument: boolean
  modifiedAt: string
}

type DomState = {
  bodyText: string
  buttons: Array<{ text: string; disabled: boolean; title: string }>
}

type RewriteScenarioResult = {
  engineId: DocumentEngineId
  workspacePath: string
  writingAssistantCalls: number
  introRemakeCalls: Record<string, number>
  editorContent: string
}

const projectRoot = path.resolve(process.cwd())
const rendererPath = path.join(projectRoot, 'dist', 'index.html')
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload', 'index.js')

const CONTINUE_CHUNKS = ['AlphaBeta', 'GammaDelta', 'OmegaEnd']
const EXPECTED_CONTINUATION = CONTINUE_CHUNKS.join('')
const SELECTED_SEGMENT = 'GammaDelta'
const REWRITTEN_SEGMENT = 'RewrittenSegment'
const INTRO_REMAKE_GENERATION_CHANNELS = [
  'inferTopicMeta',
  'buildAllowlistedPool',
  'generateDraft',
  'startGenerateDraftStream',
  'cancelGenerateDraftStream',
  'remapDraft',
  'saveTaskSnapshot',
  'exportBundle',
] as const

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let workspaceRootDir = ''
let createdWorkspacePaths: string[] = []
const workspaceRegistry = new Set<string>()
const consoleErrors: string[] = []
const pageErrors: string[] = []
let ipcRegistered = false
let writingAssistantPayloads: Array<Record<string, unknown>> = []
let introRemakeCallCounts: Record<string, number> = {}

function resetScenarioState(): void {
  writingAssistantPayloads = []
  introRemakeCallCounts = Object.fromEntries(INTRO_REMAKE_GENERATION_CHANNELS.map((key) => [key, 0]))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureFileExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[smoke] missing ${label}: ${filePath}`)
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true })
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath)
    return true
  } catch {
    return false
  }
}

function sanitizeWorkspaceName(rawName: string, fallback = `workspace-${Date.now()}`): string {
  const normalized = String(rawName || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return normalized || fallback
}

async function ensureUniqueTargetPath(targetPath: string): Promise<string> {
  if (!(await pathExists(targetPath))) return targetPath
  const directory = path.dirname(targetPath)
  const extension = path.extname(targetPath)
  const baseName = path.basename(targetPath, extension)
  let index = 1
  while (true) {
    const candidate = path.join(directory, `${baseName} copy${index > 1 ? ` ${index}` : ''}${extension}`)
    if (!(await pathExists(candidate))) return candidate
    index += 1
  }
}

async function listWorkspacesLocal(): Promise<WorkspaceInfo[]> {
  await ensureDir(workspaceRootDir)
  const entries = await fsp.readdir(workspaceRootDir, { withFileTypes: true })
  const bundledPaths = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => path.join(workspaceRootDir, entry.name))
  const candidates = Array.from(new Set([...workspaceRegistry, ...bundledPaths]))
  const workspaces = await Promise.all(candidates.map(async (wsPath) => {
    try {
      const stat = await fsp.stat(wsPath)
      if (!stat.isDirectory()) return null
      return {
        name: path.basename(wsPath),
        path: wsPath,
        hasDocument: false,
        modifiedAt: stat.mtime.toISOString(),
      }
    } catch {
      return null
    }
  }))
  return (workspaces.filter(Boolean) as WorkspaceInfo[]).sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

async function createWorkspaceLocal(name: string, parentDir?: string): Promise<{ success: boolean; path: string; name: string }> {
  const targetRoot = parentDir ? path.resolve(parentDir) : workspaceRootDir
  await ensureDir(targetRoot)
  const wsPath = await ensureUniqueTargetPath(path.join(targetRoot, sanitizeWorkspaceName(name)))
  await ensureDir(wsPath)
  await ensureDir(path.join(wsPath, 'pic'))
  workspaceRegistry.add(wsPath)
  return { success: true, path: wsPath, name: path.basename(wsPath) }
}

async function registerWorkspaceLocal(wsPath: string): Promise<{ success: boolean; path: string; name: string }> {
  const resolved = path.resolve(wsPath)
  await ensureDir(resolved)
  workspaceRegistry.add(resolved)
  return { success: true, path: resolved, name: path.basename(resolved) }
}

function getDefaultSettings(): Record<string, unknown> {
  return {
    llm: {
      provider: 'qwen',
      apiKey: '',
      useBuiltinKey: true,
      model: 'qwen3.6-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    image: {
      provider: 'nanobanana',
      apiKey: '',
      useBuiltinKey: true,
      model: 'nanobanana',
      baseUrl: '',
    },
    defaults: {
      citationMode: 'references',
      language: 'zh',
      paperType: 'review',
      noImageMode: false,
      yearFrom: '',
      yearTo: '',
      extraContext: '',
      livePreview: true,
      continueGoal: '自动补全',
      continueWords: 120,
    },
    backendUrl: '',
  }
}

async function readDomState(): Promise<DomState> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  return mainWindow.webContents.executeJavaScript(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    return {
      bodyText: normalize(document.body?.innerText),
      buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
        text: normalize(button.textContent),
        disabled: Boolean(button.disabled),
        title: normalize(button.getAttribute('title')),
      })),
    }
  })()`, true) as Promise<DomState>
}

function throwIfRendererFailed(): void {
  if (pageErrors.length > 0) {
    throw new Error(`[smoke] renderer page error: ${pageErrors[0]}`)
  }
  const fatalConsoleError = consoleErrors.find((message) => (
    message.includes('Error invoking remote method')
    || message.includes('Uncaught')
    || message.includes('TypeError')
    || message.includes('ReferenceError')
  ))
  if (fatalConsoleError) {
    throw new Error(`[smoke] renderer console error: ${fatalConsoleError}`)
  }
}

async function waitForCondition(predicate: (state: DomState) => boolean, label: string, timeoutMs: number): Promise<DomState> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    throwIfRendererFailed()
    const state = await readDomState()
    if (predicate(state)) return state
    await sleep(150)
  }
  const finalState = await readDomState().catch(() => null)
  throw new Error(`[smoke] timed out waiting for ${label}\n${JSON.stringify({ finalState, consoleErrors, pageErrors }, null, 2)}`)
}

async function waitForText(text: string, timeoutMs: number): Promise<DomState> {
  return waitForCondition((state) => state.bodyText.includes(text), `text: ${text}`, timeoutMs)
}

async function waitForMainProcessCondition(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await sleep(100)
  }
  throw new Error(`[smoke] timed out waiting for ${label}`)
}

async function executeInRenderer<T>(script: string): Promise<T> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  return mainWindow.webContents.executeJavaScript(script, true) as Promise<T>
}

async function clickButton(buttonText: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.textContent) === ${JSON.stringify(buttonText)})
    if (!button) throw new Error('Button not found: ' + ${JSON.stringify(buttonText)})
    if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(buttonText)})
    button.click()
  })()`)
}

async function clickButtonContaining(buttonText: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.textContent).includes(${JSON.stringify(buttonText)}))
    if (!button) throw new Error('Button not found: ' + ${JSON.stringify(buttonText)})
    if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(buttonText)})
    button.click()
  })()`)
}

async function clickTextContaining(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const target = Array.from(document.querySelectorAll('body *')).find((node) => normalize(node.textContent).includes(${JSON.stringify(text)}))
    if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
    if (!(target instanceof HTMLElement)) throw new Error('Target is not clickable: ' + ${JSON.stringify(text)})
    target.click()
  })()`)
}

async function clickExactText(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const matches = Array.from(document.querySelectorAll('body *'))
      .filter((node) => normalize(node.textContent) === ${JSON.stringify(text)})
      .filter((node) => node instanceof HTMLElement && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
    const target = matches.sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length)[0] || null
    if (!(target instanceof HTMLElement)) throw new Error('Exact text node not found: ' + ${JSON.stringify(text)})
    target.click()
  })()`)
}

async function configureEngine(engineId: DocumentEngineId): Promise<void> {
  await executeInRenderer(`(() => {
    window.localStorage.setItem('ai_writer_document_engine', ${JSON.stringify(engineId)})
    window.localStorage.setItem('ai_writer_document_engine_migrated_to_embedded_office', 'true')
    window.location.reload()
  })()`)
}

async function createSmokeWindow(): Promise<void> {
  consoleErrors.length = 0
  pageErrors.length = 0
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  })

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      consoleErrors.push(String(message))
    }
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    pageErrors.push(`render process gone: ${details.reason}`)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    pageErrors.push(`did-fail-load ${code}: ${description}`)
  })
  mainWindow.webContents.on('preload-error', (_event, targetPath, error) => {
    pageErrors.push(`preload error at ${targetPath}: ${String(error)}`)
  })

  await mainWindow.loadFile(rendererPath)
}

function trackIntroRemakeCall(channel: typeof INTRO_REMAKE_GENERATION_CHANNELS[number]): void {
  introRemakeCallCounts[channel] = (introRemakeCallCounts[channel] || 0) + 1
}

function registerIpcHandlers(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  const defaultSettings = getDefaultSettings()

  ipcMain.handle('app:getInfo', async () => ({
    name: 'AI-Writer 3.0',
    version: '3.0.0-alpha.1-smoke',
    userData: tempUserDataDir,
  }))
  ipcMain.on('app:getVoskTestMode', (event) => {
    event.returnValue = ''
  })
  ipcMain.handle('settings:get', async () => defaultSettings)
  ipcMain.handle('settings:save', async (_event, payload) => ({
    ...defaultSettings,
    ...((payload || {}) as Record<string, unknown>),
  }))
  ipcMain.handle('settings:testLlm', async () => 'ok')
  ipcMain.handle('settings:testImage', async () => 'ok')
  ipcMain.handle('suite:returnToLauncher', async () => ({ success: true, message: 'ok' }))
  ipcMain.handle('suite:launchCompanion', async (_event, appId) => ({ success: true, mode: 'launched', message: `smoke skipped launching companion app: ${String(appId || '')}` }))

  ipcMain.handle('introRemake:getServiceInfo', async () => ({ ready: true }))
  ipcMain.handle('introRemake:getAllowedJournals', async () => ([]))
  ipcMain.handle('introRemake:listRecentTasks', async () => ([]))
  ipcMain.handle('introRemake:saveTaskSnapshot', async () => {
    trackIntroRemakeCall('saveTaskSnapshot')
    return { success: true }
  })
  ipcMain.handle('introRemake:exportBundle', async () => {
    trackIntroRemakeCall('exportBundle')
    return { success: true }
  })
  ipcMain.handle('introRemake:testLlmSettings', async () => ({ success: true }))
  ipcMain.handle('introRemake:inferTopicMeta', async () => {
    trackIntroRemakeCall('inferTopicMeta')
    return { openalexSearch: '', persons: [], paperPublicationYear: 2024, category: '' }
  })
  ipcMain.handle('introRemake:buildAllowlistedPool', async () => {
    trackIntroRemakeCall('buildAllowlistedPool')
    return { topicMeta: null, pool: [], poolMeta: null, allowedJournals: [] }
  })
  ipcMain.handle('introRemake:generateDraft', async () => {
    trackIntroRemakeCall('generateDraft')
    return { remadeIntroduction: '', sequentialIntroduction: '', references: [] }
  })
  ipcMain.handle('introRemake:startGenerateDraftStream', async () => {
    trackIntroRemakeCall('startGenerateDraftStream')
    return 'smoke-intro-stream-id'
  })
  ipcMain.handle('introRemake:cancelGenerateDraftStream', async () => {
    trackIntroRemakeCall('cancelGenerateDraftStream')
    return { success: true }
  })
  ipcMain.handle('introRemake:remapDraft', async () => {
    trackIntroRemakeCall('remapDraft')
    return { remadeIntroduction: '', sequentialIntroduction: '', references: [] }
  })

  ipcMain.handle('knowledge:getInfo', async () => ({ rootPath: path.join(tempUserDataDir, 'knowledge-base'), documentCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  ipcMain.handle('knowledge:listDocuments', async () => [])
  ipcMain.handle('knowledge:getDocument', async () => null)
  ipcMain.handle('knowledge:getDocumentVersion', async () => null)
  ipcMain.handle('knowledge:listDocumentChunks', async () => [])
  ipcMain.handle('knowledge:retrieveChunks', async () => ({ items: [], total: 0 }))
  ipcMain.handle('knowledge:previewTaskContext', async () => ({ templateSummary: '', retrievedHits: [], citations: [] }))
  ipcMain.handle('knowledge:importDocuments', async () => ({ imported: [], duplicates: [], failed: [], canceled: false }))
  ipcMain.handle('knowledge:importDocumentFromPath', async () => ({ imported: [], duplicates: [], failed: [], canceled: false }))
  ipcMain.handle('knowledge:materializeWorkspace', async () => ({ success: true, workspacePath: '', workspaceName: '', copiedDocuments: [] }))
  ipcMain.handle('knowledge:deleteDocument', async () => ({ success: true }))
  ipcMain.handle('knowledge:setCurrentVersion', async () => ({ document: {}, version: {} }))
  ipcMain.handle('knowledge:submitRemakeTask', async () => 'noop')
  ipcMain.handle('knowledge:saveTaskRecord', async () => ({ task: { id: 'noop' } }))
  ipcMain.handle('knowledge:createRemakeVersion', async () => ({ document: {}, version: {}, task: { id: 'noop' } }))
  ipcMain.handle('knowledge:classifyDocument', async () => null)
  ipcMain.handle('knowledge:updateDocumentCategory', async () => undefined)

  ipcMain.handle('documentEngine:getActive', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:setPreferred', async (_event, engineId) => ({ engineId: String(engineId || 'legacy-tiptap-bridge'), availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:readOoxmlPackage', async () => ({ filePath: '', exists: false, entryCount: 0, entries: [], contentTypesXml: null, documentXml: null, paragraphCount: 0, paragraphs: [], blockCount: 0, blocks: [], plainText: '', html: '' }))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_event, filePathArg) => ({ success: false, filePath: String(filePathArg || ''), paragraphCount: 0, entryCount: 0, created: false }))

  ipcMain.handle('workspace:list', async () => listWorkspacesLocal())
  ipcMain.handle('workspace:create', async (_event, name, parentDir) => {
    const result = await createWorkspaceLocal(String(name || ''), parentDir ? String(parentDir) : undefined)
    createdWorkspacePaths.push(result.path)
    return result
  })
  ipcMain.handle('workspace:rename', async (_event, wsPath, nextName) => ({ success: true, path: String(wsPath || ''), name: sanitizeWorkspaceName(String(nextName || '')) }))
  ipcMain.handle('workspace:register', async (_event, wsPath) => registerWorkspaceLocal(String(wsPath || '')))
  ipcMain.handle('workspace:tree', async () => [])
  ipcMain.handle('workspace:readDocumentSchema', async () => ({ success: true, source: 'empty', jsonPath: '', legacySourcePath: null, document: { id: 'noop', profile: 'freewrite', title: 'noop', blocks: [], meta: {} }, compatHtml: '', displayName: '未命名文档' }))
  ipcMain.handle('workspace:saveDocumentSchema', async (_event, wsPath, document) => ({ success: true, jsonPath: path.join(String(wsPath || ''), 'document.json'), document, compatHtml: '', displayName: '未命名文档', resourceCount: 0 }))
  ipcMain.handle('workspace:delete', async (_event, wsPath) => {
    await fsp.rm(String(wsPath || ''), { recursive: true, force: true })
    return { success: true }
  })
  ipcMain.handle('workspace:detectProjectStructure', async () => ({ isProject: true, hasFigures: false }))
  ipcMain.handle('workspace:createFolder', async (_event, wsPath, relativePath) => {
    const targetPath = path.join(String(wsPath || ''), String(relativePath || ''))
    await ensureDir(targetPath)
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:createFile', async (_event, wsPath, relativePath) => {
    const targetPath = path.join(String(wsPath || ''), String(relativePath || ''))
    await ensureDir(path.dirname(targetPath))
    await fsp.writeFile(targetPath, '', 'utf-8')
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:createBlankDocument', async (_event, wsPath, relativePath) => {
    const targetPath = path.join(String(wsPath || ''), String(relativePath || '').replace(/\.docx$/i, '') + '.docx')
    await ensureDir(path.dirname(targetPath))
    await fsp.writeFile(targetPath, '', 'utf-8')
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:renamePath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:copyPath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:movePath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:deletePath', async () => ({ success: true }))
  ipcMain.handle('workspace:readReferences', async () => ({ references: [] }))
  ipcMain.handle('workspace:readTaskHistory', async () => ({ tasks: [] }))
  ipcMain.handle('workspace:appendTaskHistory', async () => ({ success: true, total: 0 }))
  ipcMain.handle('workspace:saveReferences', async () => ({ success: true, total: 0 }))
  ipcMain.handle('workspace:appendReferences', async () => ({ success: true, total: 0 }))
  ipcMain.handle('workspace:saveImageToWorkspace', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:saveImageFromUrl', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:saveImageToFigures', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:writeFile', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:saveManuscript', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:saveExperimentPlan', async () => ({ success: true, path: '' }))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:openExternal', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:write', async (_event, filePathArg, content) => {
    await ensureDir(path.dirname(String(filePathArg || '')))
    await fsp.writeFile(String(filePathArg || ''), String(content || ''), 'utf-8')
    return { success: true, filePath: String(filePathArg || '') }
  })
  ipcMain.handle('file:writeDocx', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:read', async (_event, filePathArg) => ({ type: 'markdown', content: await fsp.readFile(String(filePathArg || ''), 'utf-8').catch(() => ''), filePath: String(filePathArg || '') }))
  ipcMain.handle('file:listDirectoryImages', async () => [])
  ipcMain.handle('file:importImage', async () => null)
  ipcMain.handle('file:readImageAsDataUrl', async () => ({ filePath: '', fileName: '', contentType: 'image/png', dataUrl: '' }))

  ipcMain.handle('formalTemplate:analyze', async () => ({}))
  ipcMain.handle('formalTemplate:confirmFields', async () => ({}))
  ipcMain.handle('formalTemplate:preview', async () => ({}))
  ipcMain.handle('formalTemplate:commit', async () => ({}))

  ipcMain.handle('ai:continueWriting', async () => {
    const fullText = CONTINUE_CHUNKS.join('')
    mainWindow?.webContents.send('ai:event', { scope: 'continue', type: 'start' })
    for (const chunk of CONTINUE_CHUNKS) {
      await sleep(50)
      mainWindow?.webContents.send('ai:event', { scope: 'continue', type: 'chunk', chunk })
    }
    mainWindow?.webContents.send('ai:event', { scope: 'continue', type: 'done', text: fullText })
    return fullText
  })
  ipcMain.handle('ai:rewriteParagraph', async () => '')
  ipcMain.handle('ai:writingAssistant', async (_event, payload) => {
    const normalizedPayload = (payload || {}) as Record<string, unknown>
    writingAssistantPayloads.push(normalizedPayload)
    mainWindow?.webContents.send('ai:event', { scope: 'assistant', type: 'start' })
    mainWindow?.webContents.send('ai:event', { scope: 'assistant', type: 'status', message: '正在处理当前文档...' })
    mainWindow?.webContents.send('ai:event', { scope: 'assistant', type: 'chunk', chunk: REWRITTEN_SEGMENT })
    mainWindow?.webContents.send('ai:event', { scope: 'assistant', type: 'done', text: REWRITTEN_SEGMENT })
    return REWRITTEN_SEGMENT
  })
  ipcMain.handle('ai:organizeReferences', async () => ({}))
  ipcMain.handle('ai:generateOutline', async () => '')
  ipcMain.handle('ai:analyzeTopic', async () => '')
  ipcMain.handle('ai:generateExperimentPlan', async () => '')
  ipcMain.handle('ai:generateImage', async () => ({ status: 'success', image_url: '' }))
  ipcMain.handle('ai:generatePaper', async () => ({ status: 'success', task_id: 'noop' }))
  ipcMain.handle('ai:exportPdf', async () => null)

  ipcMain.handle('compat:submitTask', async () => ({ status: 'success', task_id: 'noop' }))
  ipcMain.handle('compat:getTaskStatus', async () => ({ status: 'success', task: null }))
  ipcMain.handle('compat:getTaskResult', async () => ({ status: 'success', result: null }))
  ipcMain.handle('compat:getActiveTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:getRecentTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:pauseTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:resumeTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:stopTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:findCitationForText', async () => ({ status: 'success', citations: [] }))

  ipcMain.handle('plot:status', async () => ({ ready: false, running: false, baseUrl: '', port: 0, pythonCommand: null, agentRoot: null }))
  ipcMain.handle('plot:types', async () => ({}))
  ipcMain.handle('plot:recommend', async () => ({}))
  ipcMain.handle('plot:generate', async () => ({}))
  ipcMain.handle('plot:realtimeCreateSession', async () => ({}))
  ipcMain.handle('plot:realtimeAddPoint', async () => ({}))
  ipcMain.handle('plot:realtimeAddBatch', async () => ({}))
  ipcMain.handle('plot:realtimeGetPlot', async () => ({}))
  ipcMain.handle('plot:realtimeGetStatus', async () => ({}))
  ipcMain.handle('plot:realtimeDeleteSession', async () => ({}))
  ipcMain.handle('pptx:generate', async () => ({ success: true, outputPath: '', slideCount: 0, templateId: 'noop' }))
}

async function waitForWriterLanding(): Promise<void> {
  const initialState = await waitForCondition((state) => (
    state.bodyText.includes('选择产品入口')
    || state.bodyText.includes('+ 新建文章')
    || state.bodyText.includes('创建工作区')
  ), 'writer landing', 15000)

  if (initialState.bodyText.includes('选择产品入口')) {
    await clickButton('进入 3.0 工作台')
  }

  await waitForCondition((state) => state.bodyText.includes('+ 新建文章') || state.bodyText.includes('创建工作区'), 'workspace empty state', 15000)
}

async function selectSegment(engineId: DocumentEngineId): Promise<void> {
  if (engineId === 'legacy-tiptap-bridge') {
    await executeInRenderer(`(() => {
      const editor = document.querySelector('[contenteditable="true"]')
      if (!(editor instanceof HTMLElement)) throw new Error('Legacy editor not found')
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let targetNode = null
      let startIndex = -1
      while (walker.nextNode()) {
        const current = walker.currentNode
        const value = String(current.nodeValue || '')
        const index = value.indexOf(${JSON.stringify(SELECTED_SEGMENT)})
        if (index >= 0) {
          targetNode = current
          startIndex = index
          break
        }
      }
      if (!targetNode || startIndex < 0) throw new Error('Target selection text not found in legacy editor')
      const selection = window.getSelection()
      if (!selection) throw new Error('Window selection unavailable')
      const range = document.createRange()
      range.setStart(targetNode, startIndex)
      range.setEnd(targetNode, startIndex + ${JSON.stringify(SELECTED_SEGMENT)}.length)
      editor.focus()
      selection.removeAllRanges()
      selection.addRange(range)
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    })()`)
    return
  }

  await executeInRenderer(`(() => {
    const textarea = document.querySelector('textarea')
    if (textarea instanceof HTMLTextAreaElement) {
      const value = String(textarea.value || '')
      const start = value.indexOf(${JSON.stringify(SELECTED_SEGMENT)})
      if (start < 0) throw new Error('Target selection text not found in embedded textarea editor')
      textarea.focus()
      textarea.setSelectionRange(start, start + ${JSON.stringify(SELECTED_SEGMENT)}.length)
      textarea.dispatchEvent(new Event('select', { bubbles: true }))
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      return
    }

    const editor = document.querySelector('[contenteditable="true"]')
    if (!(editor instanceof HTMLElement)) throw new Error('Embedded editor surface not found')
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    let targetNode = null
    let startIndex = -1
    while (walker.nextNode()) {
      const current = walker.currentNode
      const value = String(current.nodeValue || '')
      const index = value.indexOf(${JSON.stringify(SELECTED_SEGMENT)})
      if (index >= 0) {
        targetNode = current
        startIndex = index
        break
      }
    }
    if (!targetNode || startIndex < 0) throw new Error('Target selection text not found in embedded fallback editor')
    const selection = window.getSelection()
    if (!selection) throw new Error('Window selection unavailable')
    const range = document.createRange()
    range.setStart(targetNode, startIndex)
    range.setEnd(targetNode, startIndex + ${JSON.stringify(SELECTED_SEGMENT)}.length)
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })()`)
}

async function openContextMenuForSelection(engineId: DocumentEngineId): Promise<void> {
  const selector = engineId === 'legacy-tiptap-bridge' ? '[contenteditable="true"]' : 'textarea, [contenteditable="true"]'
  await executeInRenderer(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)})
    if (!(editor instanceof HTMLElement)) throw new Error('Editor not found for context menu')
    const rect = editor.getBoundingClientRect()
    editor.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: Math.max(80, rect.left + 32),
      clientY: Math.max(80, rect.top + 24),
    }))
  })()`)
}

async function readEditorContent(engineId: DocumentEngineId): Promise<string> {
  if (engineId === 'legacy-tiptap-bridge') {
    return executeInRenderer(`(() => String(document.querySelector('[contenteditable="true"]')?.innerText || '').replace(/\\s+/g, ' ').trim())()`)
  }
  return executeInRenderer(`(() => {
    const textarea = document.querySelector('textarea')
    if (textarea instanceof HTMLTextAreaElement) {
      return String(textarea.value || '').replace(/\\s+/g, ' ').trim()
    }
    return String(document.querySelector('[contenteditable="true"]')?.innerText || '').replace(/\\s+/g, ' ').trim()
  })()`)
}

async function runRewriteScenario(engineId: DocumentEngineId): Promise<RewriteScenarioResult> {
  console.log(`[smoke] scenario:start engine=${engineId}`)
  resetScenarioState()
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), `ai-writer-rewrite-routing-${engineId}-`))
  workspaceRootDir = path.join(tempUserDataDir, 'workspaces')
  createdWorkspacePaths = []
  workspaceRegistry.clear()

  app.setPath('userData', tempUserDataDir)
  await createSmokeWindow()
  console.log(`[smoke] ${engineId}:window-ready`)
  await waitForWriterLanding()
  console.log(`[smoke] ${engineId}:landing-ready`)
  await configureEngine(engineId)
  await waitForWriterLanding()
  console.log(`[smoke] ${engineId}:engine-configured`)

  const workspaceName = engineId === 'legacy-tiptap-bridge' ? '重写RoutingLegacy验证' : '重写RoutingEmbedded验证'
  await executeInRenderer(`(() => { window.prompt = () => ${JSON.stringify(workspaceName)} })()`)
  await clickButton('+ 新建文章')
  await waitForMainProcessCondition(() => createdWorkspacePaths.length >= 1, `${engineId} workspace creation`, 10000)
  await waitForText(`${workspaceName}.docx`, 15000)
  console.log(`[smoke] ${engineId}:workspace-created`)

  if (engineId === 'legacy-tiptap-bridge') {
    await waitForMainProcessCondition(async () => await executeInRenderer(`document.querySelector('[contenteditable="true"]') !== null`), `${engineId} editor ready`, 15000)
  } else {
    await waitForMainProcessCondition(async () => await executeInRenderer(`document.querySelector('textarea, [contenteditable="true"]') !== null`), `${engineId} editor ready`, 15000)
  }
  console.log(`[smoke] ${engineId}:editor-ready`)

  await executeInRenderer(`(() => {
    window.dispatchEvent(new CustomEvent('ai-writer-manuscript-selection-action', {
      detail: { action: 'continue' },
    }))
  })()`)
  console.log(`[smoke] ${engineId}:continue-triggered`)
  await waitForCondition((state) => state.bodyText.includes('续写完成，已流式插入') || state.bodyText.includes('续写已完成'), `${engineId} continue completion`, 15000)
  await waitForCondition((state) => state.bodyText.includes(EXPECTED_CONTINUATION), `${engineId} continuation text`, 10000)
  console.log(`[smoke] ${engineId}:continue-completed`)

  await selectSegment(engineId)
  console.log(`[smoke] ${engineId}:selection-ready`)
  await openContextMenuForSelection(engineId)
  await waitForText('重写选中文本', 10000)
  console.log(`[smoke] ${engineId}:context-menu-open`)
  await clickExactText('✏️ 重写选中文本')

  await waitForCondition((state) => state.bodyText.includes(REWRITTEN_SEGMENT) && state.bodyText.includes('改写完成'), `${engineId} rewrite completed`, 15000)
  console.log(`[smoke] ${engineId}:rewrite-completed`)
  await clickButtonContaining('接受')
  await waitForText('已接受重写', 10000)
  console.log(`[smoke] ${engineId}:rewrite-accepted`)

  await waitForMainProcessCondition(() => writingAssistantPayloads.length === 1, `${engineId} writing assistant payload`, 5000)
  const writingPayload = writingAssistantPayloads[0] || {}
  assert.equal(String(writingPayload.documentText || ''), SELECTED_SEGMENT, `[smoke] ${engineId} rewrite should only send selected text`)
  assert.equal(String(writingPayload.instruction || '').includes('请只重写当前选中的文本。'), true, `[smoke] ${engineId} rewrite instruction missing scoped rewrite guard`)

  for (const channel of INTRO_REMAKE_GENERATION_CHANNELS) {
    assert.equal(introRemakeCallCounts[channel] || 0, 0, `[smoke] ${engineId} should not invoke introRemake:${channel}`)
  }

  const editorContent = await readEditorContent(engineId)
  assert.equal(editorContent.includes(REWRITTEN_SEGMENT), true, `[smoke] ${engineId} editor should contain rewritten segment`)
  assert.equal(editorContent.includes(SELECTED_SEGMENT), false, `[smoke] ${engineId} editor should no longer contain original selected segment`)

  const workspacePath = createdWorkspacePaths[0] || ''
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.close()
  }
  mainWindow = null

  return {
    engineId,
    workspacePath,
    writingAssistantCalls: writingAssistantPayloads.length,
    introRemakeCalls: { ...introRemakeCallCounts },
    editorContent,
  }
}

async function run(): Promise<void> {
  ensureFileExists(rendererPath, 'renderer build')
  ensureFileExists(preloadPath, 'preload build')
  app.commandLine.appendSwitch('disable-gpu')
  registerIpcHandlers()

  const legacyResult = await runRewriteScenario('legacy-tiptap-bridge')
  const embeddedResult = await runRewriteScenario('embedded-office-engine')

  console.log('[smoke] selection rewrite routing ok')
  console.log(JSON.stringify({
    selectedSegment: SELECTED_SEGMENT,
    rewrittenSegment: REWRITTEN_SEGMENT,
    legacy: legacyResult,
    embedded: embeddedResult,
  }, null, 2))
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})