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

type ContinuePositionScenario = 'document-end' | 'paragraph-start' | 'paragraph-middle'

type ContinueScenarioResult = {
  engineId: DocumentEngineId
  scenario: ContinuePositionScenario
  content: string
  workspacePath: string
}

const projectRoot = path.resolve(process.cwd())
const rendererPath = path.join(projectRoot, 'dist', 'index.html')
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload', 'index.js')
const BASE_CHUNKS = ['BaseAlpha', 'BaseBeta', 'BaseOmega']
const DOC_END_CHUNKS = ['\n\nTailAlpha', 'TailBeta']
const PARAGRAPH_START_CHUNKS = ['\nLeadAlpha', 'LeadBeta']
const PARAGRAPH_MIDDLE_CHUNKS = ['\nMidAlpha', 'MidBeta']

function normalizeContinueStart(text: string): string {
  return text.replace(/^\s+/, '')
}

const BASE_TEXT = BASE_CHUNKS.join('')
const DOC_END_TEXT = normalizeContinueStart(DOC_END_CHUNKS.join(''))
const PARAGRAPH_START_TEXT = normalizeContinueStart(PARAGRAPH_START_CHUNKS.join(''))
const PARAGRAPH_MIDDLE_TEXT = normalizeContinueStart(PARAGRAPH_MIDDLE_CHUNKS.join(''))
const PARAGRAPH_MIDDLE_OFFSET = BASE_CHUNKS[0].length

let currentContinueChunks = [...BASE_CHUNKS]

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let workspaceRootDir = ''
let createdWorkspacePaths: string[] = []
const workspaceRegistry = new Set<string>()
const consoleErrors: string[] = []
const pageErrors: string[] = []
let ipcRegistered = false

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

async function clickButtonByTitle(title: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.getAttribute('title')) === ${JSON.stringify(title)})
    if (!button) throw new Error('Button title not found: ' + ${JSON.stringify(title)})
    if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(title)})
    button.click()
  })()`)
}

async function clickTextContaining(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const target = Array.from(document.querySelectorAll('body *')).find((node) => normalize(node.textContent).includes(${JSON.stringify(text)}))
    if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
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
  ipcMain.handle('introRemake:listRecentTasks', async () => [])

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
  ipcMain.handle('workspace:readDocumentSchema', async () => ({
    success: true,
    source: 'json',
    jsonPath: '',
    legacySourcePath: null,
    document: {
      id: 'noop',
      profile: 'freewrite',
      title: 'noop',
      blocks: [{ id: 'block-1', type: 'paragraph', text: BASE_TEXT }],
      meta: {},
    },
    compatHtml: `<p>${BASE_TEXT}</p>`,
    displayName: '未命名文档',
  }))
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
    await fsp.writeFile(targetPath, BASE_TEXT, 'utf-8')
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
    const fullText = currentContinueChunks.join('')
    mainWindow?.webContents.send('ai:event', { scope: 'continue', type: 'start' })
    for (const chunk of currentContinueChunks) {
      await sleep(60)
      mainWindow?.webContents.send('ai:event', { scope: 'continue', type: 'chunk', chunk })
    }
    mainWindow?.webContents.send('ai:event', { scope: 'continue', type: 'done', text: fullText })
    return fullText
  })
  ipcMain.handle('ai:rewriteParagraph', async () => '')
  ipcMain.handle('ai:writingAssistant', async () => '')
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

function normalizeEditorText(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function setContinueChunks(chunks: string[]): void {
  currentContinueChunks = [...chunks]
}

async function ensureEditorReady(engineId: DocumentEngineId): Promise<void> {
  const selector = engineId === 'legacy-tiptap-bridge'
    ? "document.querySelector('[contenteditable=\"true\"]') !== null"
    : "document.querySelector('textarea, [contenteditable=\"true\"]') !== null"
  await waitForMainProcessCondition(async () => await executeInRenderer(selector), `${engineId} editor ready`, 15000)
}

async function triggerContinue(): Promise<void> {
  await executeInRenderer(`(() => {
    window.dispatchEvent(new CustomEvent('ai-writer-manuscript-selection-action', {
      detail: { action: 'continue' },
    }))
  })()`)
  await waitForCondition((state) => state.bodyText.includes('续写完成，已流式插入') || state.bodyText.includes('续写已完成'), 'continue completion', 15000)
  await sleep(200)
}

async function readEditorContent(engineId: DocumentEngineId): Promise<string> {
  if (engineId === 'legacy-tiptap-bridge') {
    return executeInRenderer(`(() => String(document.querySelector('[contenteditable="true"]')?.innerText || ''))()`)
  }
  const result = await executeInRenderer<{ ok: boolean; content?: string; message?: string }>(`(() => {
    try {
      const textareas = Array.from(document.querySelectorAll('textarea'))
      if (textareas.length > 0) {
        return {
          ok: true,
          content: textareas.map((node) => String(node.value || '')).join(${JSON.stringify('\n\n')}),
        }
      }
      const editor = document.querySelector('[contenteditable="true"]')
      return {
        ok: true,
        content: String(editor?.innerText || ''),
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })()`)
  if (!result?.ok) {
    throw new Error(`[smoke] embedded read content failed: ${result?.message || 'unknown error'}`)
  }
  return String(result.content || '')
}

async function waitForEditorContent(engineId: DocumentEngineId, expectedText: string, label: string): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15000) {
    const content = normalizeEditorText(await readEditorContent(engineId))
    if (content.includes(expectedText)) return content
    await sleep(120)
  }
  throw new Error(`[smoke] timed out waiting for ${label}`)
}

async function seedEditorText(engineId: DocumentEngineId, text: string): Promise<void> {
  if (engineId === 'legacy-tiptap-bridge') {
    await triggerContinue()
    await waitForEditorContent('legacy-tiptap-bridge', text, 'legacy seed text')
    return
  }

  const result = await executeInRenderer<{ ok: boolean; message?: string }>(`(() => {
    try {
      const textarea = document.querySelector('textarea')
      if (textarea instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        descriptor?.set?.call(textarea, ${JSON.stringify(text)})
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        return { ok: true }
      }
      const editor = document.querySelector('[contenteditable="true"]')
      if (!(editor instanceof HTMLElement)) throw new Error('Embedded editor surface not found')
      editor.focus()
      document.execCommand('selectAll', false)
      document.execCommand('insertText', false, ${JSON.stringify(text)})
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }))
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })()`)
  if (!result?.ok) {
    throw new Error(`[smoke] embedded seed script failed: ${result?.message || 'unknown error'}`)
  }
  await waitForEditorContent('embedded-office-engine', text, 'embedded seed text')
}

async function setCollapsedCaret(engineId: DocumentEngineId, offset: number): Promise<void> {
  if (engineId === 'legacy-tiptap-bridge') {
    await executeInRenderer(`(() => {
      const editor = document.querySelector('[contenteditable="true"]')
      if (!(editor instanceof HTMLElement)) throw new Error('Legacy editor not found')
      const selection = window.getSelection()
      if (!selection) throw new Error('Window selection unavailable')
      editor.focus()
      if (${offset} <= 0) {
        const startWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        if (!startWalker.nextNode()) throw new Error('Legacy start caret target not found')
        const range = document.createRange()
        range.setStart(startWalker.currentNode, 0)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
        return
      }
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      const textNodes = []
      let totalLength = 0
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode)
        totalLength += String(walker.currentNode.nodeValue || '').length
      }
      if (${offset} >= totalLength) {
        selection.removeAllRanges()
        selection.selectAllChildren(editor)
        selection.collapseToEnd()
        editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
        return
      }
      const offsetWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let remaining = ${offset}
      let targetNode = null
      let targetOffset = 0
      while (offsetWalker.nextNode()) {
        const current = offsetWalker.currentNode
        const length = String(current.nodeValue || '').length
        if (remaining <= length) {
          targetNode = current
          targetOffset = remaining
          break
        }
        remaining -= length
      }
      if (!targetNode) {
        const fallback = editor.lastChild
        if (!fallback || fallback.nodeType !== Node.TEXT_NODE) throw new Error('Legacy caret target not found')
        targetNode = fallback
        targetOffset = String(fallback.nodeValue || '').length
      }
      const range = document.createRange()
      range.setStart(targetNode, targetOffset)
      range.collapse(true)
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
      textarea.focus()
      textarea.setSelectionRange(${offset}, ${offset})
      textarea.dispatchEvent(new Event('select', { bubbles: true }))
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      return
    }
    const editor = document.querySelector('[contenteditable="true"]')
    if (!(editor instanceof HTMLElement)) throw new Error('Embedded editor surface not found')
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    let remaining = ${offset}
    let targetNode = null
    let targetOffset = 0
    while (walker.nextNode()) {
      const current = walker.currentNode
      const length = String(current.nodeValue || '').length
      if (remaining <= length) {
        targetNode = current
        targetOffset = remaining
        break
      }
      remaining -= length
    }
    if (!targetNode) throw new Error('Embedded caret target not found')
    const selection = window.getSelection()
    if (!selection) throw new Error('Window selection unavailable')
    const range = document.createRange()
    range.setStart(targetNode, targetOffset)
    range.collapse(true)
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })()`)
}

async function createWorkspaceAndOpen(engineId: DocumentEngineId, workspaceName: string): Promise<string> {
  await executeInRenderer(`(() => { window.prompt = () => ${JSON.stringify(workspaceName)} })()`)
  await clickButton('+ 新建文章')
  await waitForMainProcessCondition(() => createdWorkspacePaths.length >= 1, `${engineId} workspace creation`, 10000)
  await waitForText(`${workspaceName}.docx`, 15000)
  await ensureEditorReady(engineId)
  return createdWorkspacePaths[0] || ''
}

async function runPositionScenario(engineId: DocumentEngineId, scenario: ContinuePositionScenario): Promise<ContinueScenarioResult> {
  console.log(`[smoke] scenario:start engine=${engineId} scenario=${scenario}`)
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), `ai-writer-continue-${engineId}-${scenario}-`))
  workspaceRootDir = path.join(tempUserDataDir, 'workspaces')
  createdWorkspacePaths = []
  workspaceRegistry.clear()
  setContinueChunks(BASE_CHUNKS)

  app.setPath('userData', tempUserDataDir)
  await createSmokeWindow()
  console.log(`[smoke] ${engineId}:${scenario}:window-ready`)
  await waitForWriterLanding()
  console.log(`[smoke] ${engineId}:${scenario}:landing-ready`)
  await configureEngine(engineId)
  await waitForWriterLanding()
  console.log(`[smoke] ${engineId}:${scenario}:engine-configured`)

  const workspaceName = `${engineId === 'legacy-tiptap-bridge' ? '续写Legacy' : '续写Embedded'}-${scenario}`
  const workspacePath = await createWorkspaceAndOpen(engineId, workspaceName)
  console.log(`[smoke] ${engineId}:${scenario}:workspace-opened`)
  await waitForEditorContent(engineId, BASE_TEXT, `${engineId} base content`)
  console.log(`[smoke] ${engineId}:${scenario}:base-ready`)

  if (scenario === 'document-end') {
    await setCollapsedCaret(engineId, BASE_TEXT.length)
    console.log(`[smoke] ${engineId}:${scenario}:caret-set`)
    setContinueChunks(DOC_END_CHUNKS)
    await triggerContinue()
    console.log(`[smoke] ${engineId}:${scenario}:continue-finished`)
    const content = normalizeEditorText(await readEditorContent(engineId))
    assert.equal(content, `${BASE_TEXT}\n${DOC_END_TEXT}`, `[smoke] ${engineId} document-end continue should start a new paragraph: ${JSON.stringify(content)}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.close()
    }
    mainWindow = null
    return { engineId, scenario, content, workspacePath }
  }

  if (scenario === 'paragraph-start') {
    await setCollapsedCaret(engineId, 0)
    console.log(`[smoke] ${engineId}:${scenario}:caret-set`)
    setContinueChunks(PARAGRAPH_START_CHUNKS)
    await triggerContinue()
    console.log(`[smoke] ${engineId}:${scenario}:continue-finished`)
    const content = normalizeEditorText(await readEditorContent(engineId))
    assert.equal(content, `${PARAGRAPH_START_TEXT}${BASE_TEXT}`, `[smoke] ${engineId} paragraph-start continue should stay inline: ${JSON.stringify(content)}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.close()
    }
    mainWindow = null
    return { engineId, scenario, content, workspacePath }
  }

  await setCollapsedCaret(engineId, PARAGRAPH_MIDDLE_OFFSET)
  console.log(`[smoke] ${engineId}:${scenario}:caret-set`)
  setContinueChunks(PARAGRAPH_MIDDLE_CHUNKS)
  await triggerContinue()
  console.log(`[smoke] ${engineId}:${scenario}:continue-finished`)
  const content = normalizeEditorText(await readEditorContent(engineId))
  const expected = `${BASE_TEXT.slice(0, PARAGRAPH_MIDDLE_OFFSET)}${PARAGRAPH_MIDDLE_TEXT}${BASE_TEXT.slice(PARAGRAPH_MIDDLE_OFFSET)}`
  assert.equal(content, expected, `[smoke] ${engineId} paragraph-middle continue should stay inline: ${JSON.stringify(content)}`)
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.close()
  }
  mainWindow = null
  return { engineId, scenario, content, workspacePath }
}

async function run(): Promise<void> {
  ensureFileExists(rendererPath, 'renderer build')
  ensureFileExists(preloadPath, 'preload build')
  app.commandLine.appendSwitch('disable-gpu')
  registerIpcHandlers()

  const legacyResults = [
    await runPositionScenario('legacy-tiptap-bridge', 'document-end'),
    await runPositionScenario('legacy-tiptap-bridge', 'paragraph-start'),
    await runPositionScenario('legacy-tiptap-bridge', 'paragraph-middle'),
  ]
  const embeddedResults = [
    await runPositionScenario('embedded-office-engine', 'document-end'),
    await runPositionScenario('embedded-office-engine', 'paragraph-start'),
    await runPositionScenario('embedded-office-engine', 'paragraph-middle'),
  ]

  console.log('[smoke] continue stream mode ok')
  console.log(JSON.stringify({
    baseText: BASE_TEXT,
    documentEndText: DOC_END_TEXT,
    paragraphStartText: PARAGRAPH_START_TEXT,
    paragraphMiddleText: PARAGRAPH_MIDDLE_TEXT,
    legacy: legacyResults,
    embedded: embeddedResults,
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