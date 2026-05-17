import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, net } from 'electron'
import { getVoskModelInfo, registerVoskResourceProtocol, VOSK_BUNDLED_MODEL_URL } from '../electron/main/services/voskModelService'

type DomState = {
  bodyText: string
  buttons: Array<{ text: string; disabled: boolean; title: string; ariaLabel: string }>
  voiceInputValue: string
}

const projectRoot = path.resolve(process.cwd())
const uiSmokeMode = process.env.AI_WRITER_UI_SMOKE_MODE === 'packaged' ? 'packaged' : 'current'
const packagedResourcesPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources')
const packagedRendererPath = path.join(packagedResourcesPath, 'app.asar', 'dist', 'index.html')
const packagedPreloadPath = path.join(packagedResourcesPath, 'app.asar', 'dist-electron', 'preload', 'index.js')
const rendererPath = uiSmokeMode === 'packaged' ? packagedRendererPath : path.join(projectRoot, 'dist', 'index.html')
const preloadPath = uiSmokeMode === 'packaged' ? packagedPreloadPath : path.join(projectRoot, 'dist-electron', 'preload', 'index.js')
const bundledModelPath = uiSmokeMode === 'packaged'
  ? path.join(packagedResourcesPath, 'vosk-models', 'vosk-model-small-cn-0.3.tar.gz')
  : path.join(projectRoot, 'build', 'vosk-models', 'vosk-model-small-cn-0.3.tar.gz')
const VOICE_INPUT_PLACEHOLDER = '直接描述你要写的报告、通知、纪要或其他文稿需求'
const SMOKE_TRANSCRIPT = '桌面语音 smoke'

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
const consoleErrors: string[] = []
const pageErrors: string[] = []

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureFileExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[smoke] missing ${label}: ${filePath}`)
  }
}

function patchPackagedRuntime(): void {
  if (uiSmokeMode !== 'packaged') return
  try {
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: packagedResourcesPath,
    })
  } catch {
    // ignore
  }
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
    },
    backendUrl: '',
  }
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

async function executeInRenderer<T>(script: string): Promise<T> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  return mainWindow.webContents.executeJavaScript(script, true) as Promise<T>
}

async function readDomState(): Promise<DomState> {
  return executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const voiceInput = Array.from(document.querySelectorAll('input, textarea')).find((node) => String(node.getAttribute('placeholder') || '').includes(${JSON.stringify(VOICE_INPUT_PLACEHOLDER)}))
    return {
      bodyText: normalize(document.body?.innerText),
      buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
        text: normalize(button.textContent),
        disabled: Boolean(button.disabled),
        title: normalize(button.getAttribute('title')),
        ariaLabel: normalize(button.getAttribute('aria-label')),
      })),
      voiceInputValue: voiceInput ? String(voiceInput.value || '') : '',
    }
  })()`)
}

async function waitForCondition(predicate: (state: DomState) => boolean, label: string, timeoutMs: number): Promise<DomState> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    throwIfRendererFailed()
    const state = await readDomState()
    if (predicate(state)) {
      return state
    }
    await sleep(150)
  }

  const finalState = await readDomState().catch(() => null)
  throw new Error(`[smoke] timed out waiting for ${label}\n${JSON.stringify({ finalState, consoleErrors, pageErrors }, null, 2)}`)
}

async function waitForText(text: string, timeoutMs: number): Promise<DomState> {
  return waitForCondition((state) => state.bodyText.includes(text), `text: ${text}`, timeoutMs)
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

async function clickButtonByAriaLabel(ariaLabel: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.getAttribute('aria-label')) === ${JSON.stringify(ariaLabel)})
    if (!button) throw new Error('Button aria-label not found: ' + ${JSON.stringify(ariaLabel)})
    if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(ariaLabel)})
    button.click()
  })()`)
}

function registerIpcHandlers(): void {
  const defaultSettings = getDefaultSettings()

  ipcMain.on('app:getVoskTestMode', (event) => {
    event.returnValue = 'smoke'
  })
  ipcMain.handle('app:getInfo', async () => ({
    name: 'AI-Writer 3.0',
    version: '3.0.0-alpha.1-smoke',
    userData: tempUserDataDir,
    vosk: await getVoskModelInfo(),
  }))
  ipcMain.handle('settings:get', async () => defaultSettings)
  ipcMain.handle('settings:save', async (_event, payload) => ({
    ...defaultSettings,
    ...((payload || {}) as Record<string, unknown>),
  }))
  ipcMain.handle('settings:testLlm', async () => 'ok')
  ipcMain.handle('settings:testImage', async () => 'ok')
  ipcMain.handle('suite:returnToLauncher', async () => ({ success: true, message: 'ok' }))
  ipcMain.handle('suite:launchCompanion', async (_event, appId) => ({
    success: true,
    mode: 'launched',
    message: `smoke skipped launching companion app: ${String(appId || '')}`,
  }))
  ipcMain.handle('introRemake:listRecentTasks', async () => [])

  ipcMain.handle('workspace:list', async () => [])
  ipcMain.handle('workspace:create', async (_event, name, parentDir) => ({
    success: true,
    path: path.join(String(parentDir || tempUserDataDir), String(name || 'smoke-workspace')),
    name: String(name || 'smoke-workspace'),
  }))
  ipcMain.handle('workspace:rename', async (_event, wsPath, nextName) => ({ success: true, path: String(wsPath || ''), name: String(nextName || '') }))
  ipcMain.handle('workspace:register', async (_event, wsPath) => ({ success: true, path: String(wsPath || ''), name: path.basename(String(wsPath || '')) }))
  ipcMain.handle('workspace:tree', async () => [])
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('workspace:detectProjectStructure', async (_event, wsPath) => ({ isProject: true, hasFigures: false, workspacePath: String(wsPath || '') }))
  ipcMain.handle('workspace:createFolder', async (_event, wsPath, relativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(relativePath || '')) }))
  ipcMain.handle('workspace:createFile', async (_event, wsPath, relativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(relativePath || '')) }))
  ipcMain.handle('workspace:createBlankDocument', async (_event, wsPath, relativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(relativePath || '').replace(/\.docx$/i, '') + '.docx') }))
  ipcMain.handle('workspace:renamePath', async (_event, wsPath, _oldRelativePath, newRelativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(newRelativePath || '')) }))
  ipcMain.handle('workspace:copyPath', async (_event, wsPath, _sourceRelativePath, targetRelativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(targetRelativePath || '')) }))
  ipcMain.handle('workspace:movePath', async (_event, wsPath, _sourceRelativePath, targetRelativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(targetRelativePath || '')) }))
  ipcMain.handle('workspace:deletePath', async () => ({ success: true }))
  ipcMain.handle('workspace:readReferences', async () => ({ references: [] }))
  ipcMain.handle('workspace:saveReferences', async (_event, _wsPath, references) => ({ success: true, total: Array.isArray(references) ? references.length : 0 }))
  ipcMain.handle('workspace:appendReferences', async (_event, _wsPath, references) => ({ success: true, total: Array.isArray(references) ? references.length : 0 }))
  ipcMain.handle('workspace:saveImageFromUrl', async (_event, wsPath, _imageUrl, filename) => ({ success: true, path: path.join(String(wsPath || ''), String(filename || 'image.png')), relativePath: String(filename || 'image.png'), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:saveImageToFigures', async (_event, wsPath, _imageUrl, filename) => ({ success: true, path: path.join(String(wsPath || ''), 'figures', String(filename || 'image.png')), relativePath: path.join('figures', String(filename || 'image.png')), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:saveImageToWorkspace', async (_event, wsPath, filename) => ({ success: true, path: path.join(String(wsPath || ''), String(filename || 'image.png')), relativePath: String(filename || 'image.png'), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async (_event, wsPath, filename) => ({ success: true, path: path.join(String(wsPath || ''), 'figures', String(filename || 'image.png')), relativePath: path.join('figures', String(filename || 'image.png')), filename: String(filename || 'image.png') }))
  ipcMain.handle('workspace:writeFile', async (_event, wsPath, relativePath) => ({ success: true, path: path.join(String(wsPath || ''), String(relativePath || '')) }))
  ipcMain.handle('workspace:saveManuscript', async (_event, wsPath, _content, filename) => ({ success: true, path: path.join(String(wsPath || ''), String(filename || 'output.docx')) }))
  ipcMain.handle('workspace:saveExperimentPlan', async (_event, wsPath, _content, filename) => ({ success: true, path: path.join(String(wsPath || ''), String(filename || 'plan.md')) }))

  ipcMain.handle('knowledge:getInfo', async () => ({ rootPath: path.join(tempUserDataDir, 'knowledge-base'), documentCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  ipcMain.handle('knowledge:listDocuments', async () => [])
  ipcMain.handle('knowledge:getDocument', async () => null)
  ipcMain.handle('knowledge:getDocumentVersion', async () => null)
  ipcMain.handle('knowledge:listDocumentChunks', async () => [])
  ipcMain.handle('knowledge:retrieveChunks', async () => ({ query: '', items: [], total: 0 }))
  ipcMain.handle('knowledge:previewTaskContext', async () => ({ templateSummary: '', retrievedHits: [], citations: [] }))
  ipcMain.handle('knowledge:importDocuments', async () => ({ imported: [], skipped: [], errors: [], canceled: false }))
  ipcMain.handle('knowledge:importDocumentFromPath', async () => ({ imported: [], skipped: [], errors: [], canceled: false }))
  ipcMain.handle('knowledge:materializeWorkspace', async () => ({ workspacePath: '', documentPath: '', workspaceName: '', sourceManifestPath: '', sourceItems: [] }))
  ipcMain.handle('knowledge:deleteDocument', async () => ({ success: true }))
  ipcMain.handle('knowledge:setCurrentVersion', async () => ({ document: null, version: null }))
  ipcMain.handle('knowledge:submitRemakeTask', async () => '')
  ipcMain.handle('knowledge:saveTaskRecord', async () => ({ task: {} }))
  ipcMain.handle('knowledge:createRemakeVersion', async () => ({ document: null, version: null, task: null }))
  ipcMain.handle('knowledge:classifyDocument', async () => null)
  ipcMain.handle('knowledge:updateDocumentCategory', async () => undefined)

  ipcMain.handle('documentEngine:getActive', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:setPreferred', async (_event, engineId) => ({ engineId: String(engineId || 'legacy-tiptap-bridge'), availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:readOoxmlPackage', async () => ({ filePath: '', exists: false, entryCount: 0, entries: [], contentTypesXml: null, documentXml: null, paragraphCount: 0, paragraphs: [], blockCount: 0, blocks: [], plainText: '', html: '' }))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_event, filePathArg) => ({ success: false, filePath: String(filePathArg || ''), paragraphCount: 0, entryCount: 0, created: false }))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:read', async (_event, filePathArg) => ({ type: 'markdown', content: '', filePath: String(filePathArg || '') }))
  ipcMain.handle('file:listDirectoryImages', async () => [])
  ipcMain.handle('file:importImage', async () => null)
  ipcMain.handle('file:readImageAsDataUrl', async () => ({ filePath: '', fileName: '', contentType: 'image/png', dataUrl: '' }))
  ipcMain.handle('file:openExternal', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:write', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:writeDocx', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))

  ipcMain.handle('ai:continueWriting', async () => '')
  ipcMain.handle('ai:rewriteParagraph', async () => '')
  ipcMain.handle('ai:writingAssistant', async () => '')
  ipcMain.handle('ai:organizeReferences', async () => ({ references: [] }))
  ipcMain.handle('ai:generateOutline', async () => '')
  ipcMain.handle('ai:analyzeTopic', async () => '')
  ipcMain.handle('ai:generateExperimentPlan', async () => '')
  ipcMain.handle('ai:generateImage', async () => ({ images: [] }))
  ipcMain.handle('ai:generatePaper', async () => ({ paper_markdown: '' }))
  ipcMain.handle('compat:submitTask', async () => ({ status: 'success', task_id: 'smoke-task' }))
  ipcMain.handle('compat:getTaskStatus', async () => ({ status: 'success', task: null }))
  ipcMain.handle('compat:getTaskResult', async () => ({ status: 'success', result: null }))
  ipcMain.handle('compat:getActiveTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:getRecentTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:pauseTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:resumeTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:stopTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:findCitationForText', async () => ({ status: 'success', citations: [] }))
  ipcMain.handle('ai:exportPdf', async () => null)

  ipcMain.handle('plot:status', async () => ({ ready: false, running: false, baseUrl: '', port: 0, pythonCommand: null, agentRoot: null, lastError: null }))
  ipcMain.handle('plot:types', async () => ({ chart_types: [], count: 0 }))
  ipcMain.handle('plot:recommend', async () => ({ success: false }))
  ipcMain.handle('plot:generate', async () => ({ success: false, message: 'not used in smoke' }))
  ipcMain.handle('plot:realtimeCreateSession', async () => ({ success: false }))
  ipcMain.handle('plot:realtimeAddPoint', async () => ({ success: false }))
  ipcMain.handle('plot:realtimeAddBatch', async () => ({ success: false }))
  ipcMain.handle('plot:realtimeGetPlot', async () => ({ success: false }))
  ipcMain.handle('plot:realtimeGetStatus', async () => ({ success: false }))
  ipcMain.handle('plot:realtimeDeleteSession', async () => ({ success: false }))

  ipcMain.handle('formalTemplate:analyze', async () => ({ success: false }))
  ipcMain.handle('formalTemplate:confirmFields', async () => ({ success: false }))
  ipcMain.handle('formalTemplate:preview', async () => ({ success: false }))
  ipcMain.handle('formalTemplate:commit', async () => ({ success: false }))
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

async function verifyBundledModelAccess(expectBundled: boolean) {
  const modelInfo = await getVoskModelInfo()
  if (expectBundled && !modelInfo.bundled) {
    throw new Error('[smoke] packaged voice smoke expected bundled Vosk model info')
  }
  if (!expectBundled && modelInfo.bundled && !fs.existsSync(bundledModelPath)) {
    throw new Error(`[smoke] model info reported bundled model but file is missing: ${bundledModelPath}`)
  }
  if (modelInfo.bundled) {
    if (modelInfo.modelUrl !== VOSK_BUNDLED_MODEL_URL) {
      throw new Error(`[smoke] bundled model url mismatch: ${modelInfo.modelUrl}`)
    }
    const response = await net.fetch(modelInfo.modelUrl)
    if (!response.ok) {
      throw new Error(`[smoke] failed to read bundled model through custom protocol: HTTP ${response.status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('[smoke] bundled model response body is unavailable')
    }
    const firstChunk = await reader.read()
    await reader.cancel().catch(() => undefined)
    if (!firstChunk.value || firstChunk.value.byteLength === 0) {
      throw new Error('[smoke] bundled model response body is empty')
    }
  }
  return modelInfo
}

async function run(): Promise<void> {
  ensureFileExists(rendererPath, uiSmokeMode === 'packaged' ? 'packaged renderer bundle' : 'renderer build')
  ensureFileExists(preloadPath, uiSmokeMode === 'packaged' ? 'packaged preload bundle' : 'preload build')
  if (uiSmokeMode === 'packaged') {
    ensureFileExists(bundledModelPath, 'packaged Vosk model archive')
  }

  patchPackagedRuntime()
  process.env.AI_WRITER_VOSK_TEST_MODE = 'smoke'
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-vosk-voice-smoke-'))
  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  await registerVoskResourceProtocol()
  const mainProcessModelInfo = await verifyBundledModelAccess(uiSmokeMode === 'packaged')
  registerIpcHandlers()
  await createSmokeWindow()

  await waitForText('选择产品入口', 15000)
  await executeInRenderer("window.__AI_WRITER_VOSK_TEST_MODE__ = 'smoke'; window.localStorage.setItem('AI_WRITER_VOSK_TEST_MODE', 'smoke')")
  await clickButton('进入 3.0 工作台')
  await waitForCondition((state) => state.bodyText.includes('新建文章') && state.bodyText.includes('打开已有文章目录'), 'writer no-workspace entry', 15000)
  await waitForCondition((state) => state.buttons.some((button) => button.ariaLabel === '开启语音输入' && !button.disabled), 'voice entry button ready', 10000)

  const rendererVoskTestMode = await executeInRenderer<{ globalValue: string; storedValue: string }>(`(() => ({
    globalValue: String(window.__AI_WRITER_VOSK_TEST_MODE__ || ''),
    storedValue: String(window.localStorage.getItem('AI_WRITER_VOSK_TEST_MODE') || ''),
  }))()`)
  if (rendererVoskTestMode.globalValue !== 'smoke' && rendererVoskTestMode.storedValue !== 'smoke') {
    throw new Error(`[smoke] renderer did not receive Vosk smoke mode: ${JSON.stringify(rendererVoskTestMode)}`)
  }

  const rendererAppInfo = await executeInRenderer<Record<string, any>>('window.electronAPI.getAppInfo()')
  const rendererVoskInfo = rendererAppInfo?.vosk || null
  if (uiSmokeMode === 'packaged' && !rendererVoskInfo?.bundled) {
    throw new Error('[smoke] renderer app info did not report bundled Vosk model in packaged mode')
  }

  await clickButtonByAriaLabel('开启语音输入')
  await waitForCondition((state) => state.buttons.some((button) => button.ariaLabel === '停止语音输入') && state.voiceInputValue.includes(SMOKE_TRANSCRIPT), 'voice transcription started', 10000)

  await clickButtonByAriaLabel('停止语音输入')
  const finalState = await waitForCondition((state) => state.buttons.some((button) => button.ariaLabel === '开启语音输入') && state.voiceInputValue.includes(SMOKE_TRANSCRIPT), 'voice transcription stopped', 10000)

  console.log('[smoke] vosk voice entry flow ok')
  console.log(JSON.stringify({
    mode: uiSmokeMode,
    mainProcessModelInfo,
    rendererVoskInfo,
    finalVoiceInputValue: finalState.voiceInputValue,
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

app.on('window-all-closed', (event: { preventDefault: () => void }) => {
  event.preventDefault()
})
