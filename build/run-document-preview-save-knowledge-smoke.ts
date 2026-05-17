import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { app, BrowserWindow, ipcMain, type Event } from 'electron'
import { KnowledgeService } from '../electron/main/services/knowledgeService'

type DomState = {
  bodyText: string
  buttons: Array<{ text: string; disabled: boolean; title: string; testId: string }>
}

type WorkspaceInfo = {
  name: string
  path: string
  hasDocument: boolean
  modifiedAt: string
}

const projectRoot = path.resolve(process.cwd())
const rendererPath = path.join(projectRoot, 'dist', 'index.html')
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload', 'index.js')

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let workspacePath = ''
let knowledgeRoot = ''
let sourceDocumentPath = ''
let sourceDocumentTitle = ''
let knowledgeService: KnowledgeService | null = null
let importFromPathCount = 0

const consoleErrors: string[] = []
const pageErrors: string[] = []

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureFileExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[smoke] missing ${label}: ${filePath}`)
  }
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function createDocx(filePath: string, paragraphs: string[]): Promise<void> {
  const body = paragraphs.map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`).join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr/>
  </w:body>
</w:document>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fsp.writeFile(filePath, output)
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
      livePreview: true,
    },
    backendUrl: '',
  }
}

function buildWorkspaceTree(): Array<{ name: string; path: string; relativePath: string; type: 'file'; size: number }> {
  if (!sourceDocumentPath || !fs.existsSync(sourceDocumentPath)) return []
  const stat = fs.statSync(sourceDocumentPath)
  return [{
    name: path.basename(sourceDocumentPath),
    path: sourceDocumentPath,
    relativePath: path.basename(sourceDocumentPath),
    type: 'file',
    size: stat.size,
  }]
}

function registerIpcHandlers(workspaces: WorkspaceInfo[]): void {
  const defaultSettings = getDefaultSettings()

  ipcMain.on('app:getVoskTestMode', (event) => {
    event.returnValue = ''
  })

  ipcMain.handle('app:getInfo', async () => ({
    name: 'AI-Writer 3.0',
    version: '3.0.0-alpha.1-smoke',
    userData: tempUserDataDir,
  }))
  ipcMain.handle('settings:get', async () => defaultSettings)
  ipcMain.handle('settings:save', async (_event, payload) => ({
    ...defaultSettings,
    ...((payload || {}) as Record<string, unknown>),
  }))
  ipcMain.handle('suite:returnToLauncher', async () => ({ success: true, message: 'ok' }))
  ipcMain.handle('suite:launchCompanion', async (_event, appId) => ({
    success: true,
    mode: 'launched',
    message: `smoke skipped launching companion app: ${String(appId || '')}`,
  }))
  ipcMain.handle('introRemake:listRecentTasks', async () => [])

  ipcMain.handle('workspace:list', async () => workspaces)
  ipcMain.handle('workspace:create', async (_event, name, parentDir) => ({
    success: true,
    path: path.join(String(parentDir || tempUserDataDir), String(name || 'smoke-document-preview-save-knowledge-workspace')),
    name: String(name || 'smoke-document-preview-save-knowledge-workspace'),
  }))
  ipcMain.handle('workspace:register', async (_event, wsPath) => ({
    success: true,
    path: String(wsPath || workspacePath),
    name: path.basename(String(wsPath || workspacePath)),
  }))
  ipcMain.handle('workspace:rename', async (_event, wsPath, nextName) => ({
    success: true,
    path: String(wsPath || workspacePath),
    name: String(nextName || path.basename(String(wsPath || workspacePath))),
  }))
  ipcMain.handle('workspace:tree', async () => buildWorkspaceTree())
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('workspace:detectProjectStructure', async () => ({ isProject: true, hasFigures: true }))
  ipcMain.handle('workspace:createFolder', async (_event, wsPathArg, relativePath) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(relativePath || '')) }))
  ipcMain.handle('workspace:createFile', async (_event, wsPathArg, relativePath) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(relativePath || '')) }))
  ipcMain.handle('workspace:createBlankDocument', async (_event, wsPathArg, relativePath) => {
    const targetPath = path.join(String(wsPathArg || workspacePath), String(relativePath || '未命名文档.docx'))
    await fsp.mkdir(path.dirname(targetPath), { recursive: true })
    await createDocx(targetPath, [
      path.basename(targetPath, '.docx'),
      '这是一份用于验证“存入知识库”按钮的 smoke 文稿。',
      '点击后应通过 by-path import 进入知识库，并在界面上回写成功状态。',
    ])
    sourceDocumentPath = targetPath
    sourceDocumentTitle = path.basename(targetPath, '.docx')
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:renamePath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:copyPath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:movePath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:deletePath', async () => ({ success: true }))
  ipcMain.handle('workspace:readReferences', async () => ({ references: [] }))
  ipcMain.handle('workspace:saveReferences', async (_event, _wsPath, references) => ({ success: true, total: Array.isArray(references) ? references.length : 0 }))
  ipcMain.handle('workspace:appendReferences', async (_event, _wsPath, references) => ({ success: true, total: Array.isArray(references) ? references.length : 0 }))
  ipcMain.handle('workspace:writeFile', async (_event, wsPathArg, relativePath, content) => {
    const target = path.join(String(wsPathArg || workspacePath), String(relativePath || 'output.txt'))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, String(content || ''), 'utf-8')
    return { success: true, path: target }
  })
  ipcMain.handle('workspace:saveManuscript', async (_event, wsPathArg, content, filename) => {
    const target = path.join(String(wsPathArg || workspacePath), String(filename || 'output.docx'))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, String(content || ''), 'utf-8')
    return { success: true, path: target }
  })
  ipcMain.handle('workspace:saveExperimentPlan', async (_event, wsPathArg, content, filename) => {
    const target = path.join(String(wsPathArg || workspacePath), String(filename || 'plan.md'))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, String(content || ''), 'utf-8')
    return { success: true, path: target }
  })
  ipcMain.handle('workspace:saveImageToWorkspace', async (_event, wsPathArg, filename) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(filename || 'image.png')), relativePath: String(filename || 'image.png'), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async (_event, wsPathArg, filename) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), 'figures', String(filename || 'image.png')), relativePath: path.join('figures', String(filename || 'image.png')), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:saveImageFromUrl', async (_event, wsPathArg, imageUrl, filename) => ({ success: true, path: String(imageUrl || path.join(String(wsPathArg || workspacePath), String(filename || 'image.png'))), relativePath: String(filename || 'image.png'), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:saveImageToFigures', async (_event, wsPathArg, imageUrl, filename) => ({ success: true, path: String(imageUrl || path.join(String(wsPathArg || workspacePath), 'figures', String(filename || 'image.png'))), relativePath: path.join('figures', String(filename || 'image.png')), filename: String(filename || 'image.png') }))

  ipcMain.handle('knowledge:getInfo', async () => knowledgeService!.getInfo())
  ipcMain.handle('knowledge:listDocuments', async (_event, query) => knowledgeService!.listDocuments(typeof query === 'string' ? query : undefined))
  ipcMain.handle('knowledge:getDocument', async (_event, documentId) => knowledgeService!.getDocument(String(documentId || '')))
  ipcMain.handle('knowledge:getDocumentVersion', async (_event, documentId, versionId) => knowledgeService!.getDocumentVersion(String(documentId || ''), String(versionId || '')))
  ipcMain.handle('knowledge:listDocumentChunks', async () => [])
  ipcMain.handle('knowledge:retrieveChunks', async () => ({ items: [], total: 0 }))
  ipcMain.handle('knowledge:previewTaskContext', async () => ({ templateSummary: '', retrievedHits: [], citations: [] }))
  ipcMain.handle('knowledge:materializeWorkspace', async () => ({ success: true, workspacePath, workspaceName: path.basename(workspacePath), copiedDocuments: [] }))
  ipcMain.handle('knowledge:deleteDocument', async (_event, documentId) => knowledgeService!.deleteDocument(String(documentId || '')))
  ipcMain.handle('knowledge:saveTaskRecord', async () => ({ task: { id: 'document-preview-save-knowledge-smoke-task' } }))
  ipcMain.handle('knowledge:createRemakeVersion', async () => ({ document: null, version: null, task: null }))
  ipcMain.handle('knowledge:setCurrentVersion', async () => ({ document: null, version: null }))
  ipcMain.handle('knowledge:submitRemakeTask', async () => ({ success: true }))
  ipcMain.handle('knowledge:importDocuments', async () => ({ ...(await knowledgeService!.importDocuments([])), canceled: false }))
  ipcMain.handle('knowledge:importDocumentFromPath', async (_event, filePath) => {
    importFromPathCount += 1
    return { ...(await knowledgeService!.importDocuments([String(filePath || '')])), canceled: false }
  })
  ipcMain.handle('knowledge:classifyDocument', async () => null)
  ipcMain.handle('knowledge:updateDocumentCategory', async () => undefined)

  ipcMain.handle('documentEngine:getActive', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:setPreferred', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:readOoxmlPackage', async () => ({ filePath: '', exists: false, entryCount: 0, entries: [], contentTypesXml: null, documentXml: null, paragraphCount: 0, paragraphs: [], blockCount: 0, blocks: [], plainText: '', html: '' }))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || ''), paragraphCount: 0, entryCount: 0, created: true }))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:read', async (_event, filePathArg) => ({ type: 'txt', content: `已打开 smoke 文稿\n${path.basename(String(filePathArg || sourceDocumentPath))}`, filePath: String(filePathArg || sourceDocumentPath) }))
  ipcMain.handle('file:listDirectoryImages', async () => [])
  ipcMain.handle('file:importImage', async () => null)
  ipcMain.handle('file:readImageAsDataUrl', async () => ({ filePath: '', fileName: 'image.png', contentType: 'image/png', dataUrl: '' }))
  ipcMain.handle('file:openExternal', async (_event, filePathArg) => ({ success: true, error: null, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:copyToPath', async (_event, sourcePath, targetPath) => {
    const source = String(sourcePath || '').trim()
    const target = String(targetPath || '').trim()
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.copyFile(source, target)
    return { success: true, path: target }
  })
  ipcMain.handle('file:write', async (_event, filePathArg, content) => {
    const target = String(filePathArg || '').trim()
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, String(content || ''), 'utf-8')
    return { success: true, filePath: target }
  })
  ipcMain.handle('file:writeDocx', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))

  ipcMain.handle('formalTemplate:analyze', async () => ({}))
  ipcMain.handle('formalTemplate:confirmFields', async () => ({}))
  ipcMain.handle('formalTemplate:preview', async () => ({}))
  ipcMain.handle('formalTemplate:commit', async () => ({}))

  ipcMain.handle('ai:continueWriting', async () => '')
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
        testId: normalize(button.getAttribute('data-testid')),
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

async function waitForMainProcessCondition(predicate: () => boolean, label: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
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

async function clickByTestId(testId: string): Promise<void> {
  await executeInRenderer(`(() => {
    const target = document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)})
    if (!(target instanceof HTMLElement)) throw new Error('Element not found: ' + ${JSON.stringify(testId)})
    if ('disabled' in target && Boolean(target.disabled)) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(testId)})
    }
    target.click()
  })()`)
}

async function clickTextContaining(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const candidates = Array.from(document.querySelectorAll('body *')).filter((node) => normalize(node.textContent).includes(${JSON.stringify(text)}))
    const target = candidates.sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length)[0] || null
    if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
    target.click()
  })()`)
}

async function createSmokeWindow(): Promise<void> {
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
      console.error('[smoke] renderer console', String(message))
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

async function run(): Promise<void> {
  ensureFileExists(rendererPath, 'renderer build')
  ensureFileExists(preloadPath, 'preload build')

  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-document-preview-save-knowledge-smoke-'))
  workspacePath = path.join(tempUserDataDir, 'workspaces', 'smoke-document-preview-save-knowledge-workspace')
  knowledgeRoot = path.join(tempUserDataDir, 'knowledge-base')
  await fsp.mkdir(workspacePath, { recursive: true })
  sourceDocumentPath = ''
  sourceDocumentTitle = '未命名文档'

  knowledgeService = new KnowledgeService(knowledgeRoot)
  await knowledgeService.initialize()

  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers([
    {
      name: 'smoke-document-preview-save-knowledge-workspace',
      path: workspacePath,
      hasDocument: true,
      modifiedAt: '2026-04-15T08:00:00.000Z',
    },
  ])

  await createSmokeWindow()

  const initialState = await waitForCondition(
    (state) => state.bodyText.includes('进入 3.0 工作台') || state.bodyText.includes('smoke-document-preview-save-knowledge-workspace'),
    'app shell ready',
    15000,
  )
  if (initialState.bodyText.includes('进入 3.0 工作台')) {
    await clickButton('进入 3.0 工作台')
    await waitForText('smoke-document-preview-save-knowledge-workspace', 15000)
  }

  await clickTextContaining('smoke-document-preview-save-knowledge-workspace')
  await waitForCondition(
    (state) => state.bodyText.includes('当前工作区: smoke-document-preview-save-knowledge-workspace') || !state.bodyText.includes('当前工作区: 未限定工作区'),
    'workspace activation',
    15000,
  )

  await waitForText('+ 新建文档', 15000)
  await clickButton('+ 新建文档')
  await waitForText('未命名文档', 15000)
  await clickByTestId('workspace-mode-formal-template-button')
  await clickButton('成文预览')

  await waitForCondition(
    (state) => state.buttons.some((button) => button.testId === 'document-preview-save-knowledge-button' && !button.disabled),
    'document floating save knowledge button',
    15000,
  )
  await clickByTestId('document-preview-save-knowledge-button')

  await waitForText('已存入知识库', 15000)
  await waitForMainProcessCondition(() => importFromPathCount >= 1, 'knowledge import by path', 5000)

  const knowledgeDocuments = await knowledgeService.listDocuments()
  if (knowledgeDocuments.length !== 1) {
    throw new Error(`[smoke] expected 1 imported document, got ${knowledgeDocuments.length}`)
  }
  const importedDocument = knowledgeDocuments[0]
  if (!importedDocument.title.includes(sourceDocumentTitle)) {
    throw new Error(`[smoke] imported document title mismatch: ${importedDocument.title}`)
  }
  if (importFromPathCount !== 1) {
    throw new Error(`[smoke] expected exactly 1 importKnowledgeDocumentFromPath call, got ${importFromPathCount}`)
  }

  console.log(JSON.stringify({
    workspacePath,
    importedDocumentTitle: importedDocument.title,
    importFromPathCount,
  }, null, 2))
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    app.exit(1)
  }
})

app.on('window-all-closed', (event: Event) => {
  event.preventDefault()
})