import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

import { IntroductionRemakeService } from '../../introduction-remake-app/electron/main/services/introductionRemake/introductionRemakeService'
import { testLocalLlmConnection } from '../../introduction-remake-app/electron/main/services/introductionRemake/llmClient'
import type { LiteraturePoolItem } from '../../introduction-remake-app/electron/main/services/introductionRemake/types'
import { hydrateQwenEnv, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL, QWEN_DEFAULT_PROVIDER } from './qwenDefaults'

type DomState = {
  shellReady: boolean
  pdfInputReady: boolean
  editorReady: boolean
  editorText: string
  progressMessage: string
  progressStats: string[]
  progressLog: string[]
  statusItems: string[]
  summaryItems: string[]
  errorMessage: string
  previewVisible: boolean
  activeEditorTab: string
  startButtonDisabled: boolean
  startButtonVisible: boolean
  stopButtonVisible: boolean
  headerButtons: Array<{ text: string; disabled: boolean }>
  statusHeadline: string
  statusDetail: string
}

type StreamEventPayload = {
  streamId?: string
  type?: string
  delta?: string
  accumulated?: string
  error?: string
}

const projectRoot = path.resolve(process.cwd())
const packagedResourcesPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources')
const packagedRendererPath = path.join(packagedResourcesPath, 'introduction-remake-app', 'dist', 'index.html')
const packagedPreloadPath = path.join(packagedResourcesPath, 'app.asar', 'dist-electron', 'preload', 'index.js')
const samplePdfPath = path.resolve(
  process.argv[2] || path.join(projectRoot, '..', 'introduction-remake-app', 'build', 'samples', 'introduction-remake-multipage-sample.pdf'),
)

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let lastStreamEvent: StreamEventPayload | null = null
const activeIntroductionDraftStreams = new Map<string, { cancel: () => void }>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureFileExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[smoke] missing ${label}: ${filePath}`)
  }
}

async function hydrateIntroductionRemakeEnv(): Promise<void> {
  const keys = hydrateQwenEnv(projectRoot)
  if (keys.qwenApiKey) {
    console.log('[smoke] loaded Qwen env from local env or builtin config')
  }
}

function patchPackagedRuntime(): void {
  try {
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: packagedResourcesPath,
    })
  } catch {
    // Ignore if Electron runtime marks it non-configurable in this environment.
  }
}

function normalizeSettingsPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const provider = String(payload.provider || QWEN_DEFAULT_PROVIDER).trim() || QWEN_DEFAULT_PROVIDER
  return {
    provider,
    apiKey: String(payload.apiKey || process.env.AI_WRITER_DEFAULT_QWEN_API_KEY || process.env.QWEN_API_KEY || '').trim(),
    model: String(payload.model || process.env.QWEN_MODEL || QWEN_DEFAULT_MODEL).trim(),
    customEndpoint: String(payload.customEndpoint || process.env.QWEN_BASE_URL || QWEN_DEFAULT_BASE_URL).trim(),
    backendUrl: String(payload.backendUrl || '').trim(),
  }
}

function registerIpcHandlers(service: IntroductionRemakeService): void {
  const defaultSettings = normalizeSettingsPayload({})

  ipcMain.handle('app:getInfo', async () => ({
    name: 'AI-Writer 3.0 Packaged Smoke',
    version: '0.1.0-smoke',
    userData: tempUserDataDir,
  }))
  ipcMain.handle('settings:get', async () => defaultSettings)
  ipcMain.handle('settings:save', async (_event, settings) => ({
    ...defaultSettings,
    ...normalizeSettingsPayload((settings || {}) as Record<string, unknown>),
  }))
  ipcMain.handle('suite:returnToLauncher', async () => ({
    success: true,
    message: 'packaged smoke does not navigate back to launcher',
  }))
  ipcMain.handle('introRemake:getServiceInfo', async () => service.getServiceInfo())
  ipcMain.handle('introRemake:getAllowedJournals', async () => service.getAllowedJournalsMetadata())
  ipcMain.handle('introRemake:listRecentTasks', async () => [])
  ipcMain.handle('introRemake:saveTaskSnapshot', async () => ({ success: true }))
  ipcMain.handle('introRemake:exportBundle', async () => ({ success: false, canceled: true }))
  ipcMain.handle('introRemake:testLlmSettings', async (_event, payload) => testLocalLlmConnection(
    normalizeSettingsPayload((payload || {}) as Record<string, unknown>),
  ))
  ipcMain.handle('introRemake:inferTopicMeta', async (_event, introductionText) => service.inferTopicMeta(String(introductionText || '')))
  ipcMain.handle('introRemake:buildAllowlistedPool', async (_event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    return service.buildAllowlistedPool({
      topic: String(record.topic || ''),
      minPublicationYear: Math.max(1990, Math.min(2035, Number(record.minPublicationYear) || 2015)),
      maxPapersForLlm: Math.max(1, Math.min(8, Number(record.maxPapersForLlm) || 8)),
      secondPassTopic: typeof record.secondPassTopic === 'string' ? record.secondPassTopic : undefined,
    })
  })
  ipcMain.handle('introRemake:generateDraft', async (_event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    return service.generateDraft({
      originalIntroduction: String(record.originalIntroduction || ''),
      pool: Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
      context: typeof record.context === 'string' ? record.context : undefined,
    })
  })
  ipcMain.handle('introRemake:startGenerateDraftStream', async (event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    const streamId = `intro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) {
      throw new Error('未找到可用窗口，无法启动流式重写。')
    }

    const streamHandle = service.generateDraftStream({
      originalIntroduction: String(record.originalIntroduction || ''),
      pool: Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
      context: typeof record.context === 'string' ? record.context : undefined,
      onDelta: ({ delta, accumulated }) => {
        const payload = { streamId, type: 'delta', delta, accumulated }
        lastStreamEvent = payload
        browserWindow.webContents.send('introRemake:generateDraftStreamEvent', payload)
      },
      onComplete: (result) => {
        activeIntroductionDraftStreams.delete(streamId)
        const payload = { streamId, type: 'complete', result }
        lastStreamEvent = payload
        browserWindow.webContents.send('introRemake:generateDraftStreamEvent', payload)
      },
      onError: (errorMessage) => {
        activeIntroductionDraftStreams.delete(streamId)
        const payload = { streamId, type: 'error', error: errorMessage }
        lastStreamEvent = payload
        browserWindow.webContents.send('introRemake:generateDraftStreamEvent', payload)
      },
    })

    activeIntroductionDraftStreams.set(streamId, streamHandle)
    lastStreamEvent = { streamId, type: 'start' }
    browserWindow.webContents.send('introRemake:generateDraftStreamEvent', { streamId, type: 'start' })
    return { streamId }
  })
  ipcMain.handle('introRemake:cancelGenerateDraftStream', async (_event, streamId) => {
    const id = String(streamId || '')
    const handle = activeIntroductionDraftStreams.get(id)
    if (handle) {
      handle.cancel()
      activeIntroductionDraftStreams.delete(id)
    }
    return { success: true }
  })
  ipcMain.handle('introRemake:remapDraft', async (_event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    return service.remapDraft(
      String(record.remadeIntroduction || ''),
      Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
    )
  })
}

async function readDomState(): Promise<DomState> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }

  return mainWindow.webContents.executeJavaScript(`(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const editor = document.querySelector('.editor-surface .paper-sheet__content-rich')
    const buttons = Array.from(document.querySelectorAll('button')).map((button) => ({
      text: normalize(button.textContent),
      disabled: Boolean(button.disabled),
    }))
    const startButton = buttons.find((item) => item.text === '开始重写')
    const stopButton = buttons.find((item) => item.text === '停止重写')
    const summaryItems = Array.from(document.querySelectorAll('.panel-inline-summary span')).map((node) => normalize(node.textContent)).filter(Boolean)
    const statusItems = Array.from(document.querySelectorAll('.panel-inline-summary span, .editor-status-strip strong, .editor-status-strip span')).map((node) => normalize(node.textContent)).filter(Boolean)
    const progressMeta = Array.from(document.querySelectorAll('.pdf-import-stream__meta span')).map((node) => normalize(node.textContent))
    const progressLog = Array.from(document.querySelectorAll('.pdf-import-stream__log span')).map((node) => normalize(node.textContent)).filter(Boolean)
    const statusHeadline = normalize(document.querySelector('.editor-status-strip strong')?.textContent)
    const statusDetail = normalize(document.querySelector('.editor-status-strip span')?.textContent)
    const activeEditorTab = normalize(document.querySelector('.editor-surface-tab.active')?.textContent)
    const errorBanner = document.querySelector('.error-banner')

    return {
      shellReady: Boolean(document.querySelector('.workspace-shell')),
      pdfInputReady: Boolean(document.querySelector('input[type="file"][accept*="pdf"]')),
      editorReady: Boolean(editor),
      editorText: normalize(editor ? editor.innerText : ''),
      progressMessage: progressMeta[0] || '',
      progressStats: progressMeta,
      progressLog,
      statusItems,
      summaryItems,
      errorMessage: normalize(errorBanner ? errorBanner.textContent : ''),
      previewVisible: Boolean(document.querySelector('.pdf-preview-image')),
      activeEditorTab,
      startButtonDisabled: startButton ? Boolean(startButton.disabled) : true,
      startButtonVisible: Boolean(startButton),
      stopButtonVisible: Boolean(stopButton),
      headerButtons: buttons,
      statusHeadline,
      statusDetail,
    }
  })()`, true) as Promise<DomState>
}

async function waitForRendererReady(timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await readDomState()
    if (state.shellReady && state.pdfInputReady && state.editorReady) {
      return
    }
    await sleep(150)
  }
  throw new Error('[smoke] renderer did not become ready in time')
}

async function injectPdfFile(pdfPath: string): Promise<void> {
  if (!mainWindow) {
    throw new Error('[smoke] browser window is not available')
  }

  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64')
  const fileName = path.basename(pdfPath)

  await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[type="file"][accept*="pdf"]')
    if (!input) {
      throw new Error('PDF file input not found')
    }

    const binary = atob(${JSON.stringify(pdfBase64)})
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    const file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'application/pdf' })
    const transfer = new DataTransfer()
    transfer.items.add(file)

    try {
      input.files = transfer.files
    } catch {
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: transfer.files,
      })
    }

    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`, true)
}

async function clickButton(buttonText: string): Promise<void> {
  if (!mainWindow) {
    throw new Error('[smoke] browser window is not available')
  }

  await mainWindow.webContents.executeJavaScript(`(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.textContent) === ${JSON.stringify(buttonText)})
    if (!button) {
      throw new Error('Button not found: ' + ${JSON.stringify(buttonText)})
    }
    if (button.disabled) {
      throw new Error('Button is disabled: ' + ${JSON.stringify(buttonText)})
    }
    button.click()
  })()`, true)
}

async function waitForImportReady(timeoutMs: number): Promise<DomState> {
  const startedAt = Date.now()
  let lastProgressMessage = ''
  let lastHeadline = ''

  while (Date.now() - startedAt < timeoutMs) {
    const state = await readDomState()
    if (state.progressMessage && state.progressMessage !== lastProgressMessage) {
      lastProgressMessage = state.progressMessage
      console.log('[smoke] import progress:', state.progressMessage)
    }
    if (state.statusHeadline && state.statusHeadline !== lastHeadline) {
      lastHeadline = state.statusHeadline
      console.log('[smoke] status:', state.statusHeadline)
    }

    if (state.errorMessage) {
      throw new Error(`[smoke] renderer error during import: ${state.errorMessage}`)
    }

    const importedEditorContentReady = state.editorText.length >= 1000
    const poolSummaryReady = state.summaryItems.some((item) => item.includes('文献池'))
    const poolStatusReady = state.statusItems.some((item) => item.includes('文献池'))
    if (
      state.previewVisible
      && state.startButtonVisible
      && !state.startButtonDisabled
      && importedEditorContentReady
      && poolSummaryReady
      && poolStatusReady
    ) {
      return state
    }

    await sleep(300)
  }

  const finalState = await readDomState()
  throw new Error(`[smoke] timed out waiting for import-ready state\n${JSON.stringify(finalState, null, 2)}`)
}

async function waitForStreamStart(timeoutMs: number): Promise<DomState> {
  const startedAt = Date.now()
  let lastHeadline = ''

  while (Date.now() - startedAt < timeoutMs) {
    const state = await readDomState()
    if (state.statusHeadline && state.statusHeadline !== lastHeadline) {
      lastHeadline = state.statusHeadline
      console.log('[smoke] rewrite status:', state.statusHeadline)
    }

    if (state.errorMessage) {
      throw new Error(`[smoke] renderer error during rewrite: ${state.errorMessage}`)
    }
    if (lastStreamEvent?.type === 'error') {
      throw new Error(`[smoke] draft stream error: ${String(lastStreamEvent.error || 'unknown error')}`)
    }

    const streamStarted = state.stopButtonVisible || state.statusHeadline.includes('正在流式生成') || state.statusDetail.includes('已连接流式重写')
    const streamHasDelta = lastStreamEvent?.type === 'delta' || lastStreamEvent?.type === 'complete'
    if (streamStarted && streamHasDelta) {
      return state
    }

    await sleep(300)
  }

  const finalState = await readDomState()
  throw new Error(`[smoke] timed out waiting for rewrite stream start\n${JSON.stringify({ finalState, lastStreamEvent }, null, 2)}`)
}

async function stopActiveStreamIfNeeded(): Promise<void> {
  if (!mainWindow) {
    return
  }

  const state = await readDomState().catch(() => null)
  if (state?.stopButtonVisible) {
    await clickButton('停止重写').catch(() => undefined)
    await sleep(500)
  }
}

async function createSmokeWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 940,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: packagedPreloadPath,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  })

  mainWindow.on('unresponsive', () => {
    console.error('[smoke] window became unresponsive')
  })

  await mainWindow.loadFile(packagedRendererPath)
}

async function run(): Promise<void> {
  ensureFileExists(packagedRendererPath, 'packaged renderer bundle')
  ensureFileExists(packagedPreloadPath, 'packaged preload bundle')
  ensureFileExists(samplePdfPath, 'sample pdf')
  ensureFileExists(path.join(packagedResourcesPath, 'data', 'tier1_journals.json'), 'packaged tier1_journals.json')

  await hydrateIntroductionRemakeEnv()
  patchPackagedRuntime()

  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-packaged-intro-smoke-'))
  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  const service = new IntroductionRemakeService()
  registerIpcHandlers(service)
  await createSmokeWindow()
  await waitForRendererReady(15000)
  console.log('[smoke] packaged renderer mounted')

  await injectPdfFile(samplePdfPath)
  console.log('[smoke] dispatched packaged PDF import for', path.basename(samplePdfPath))

  const importState = await waitForImportReady(180000)
  console.log('[smoke] import-ready summary =')
  console.log(JSON.stringify({
    editorTextLength: importState.editorText.length,
    summaryItems: importState.summaryItems,
    statusItems: importState.statusItems,
    progressLogTail: importState.progressLog.slice(-5),
  }, null, 2))

  await clickButton('开始重写')
  console.log('[smoke] clicked 开始重写')

  const streamState = await waitForStreamStart(120000)
  console.log('[smoke] rewrite-stream-started =')
  console.log(JSON.stringify({
    activeEditorTab: streamState.activeEditorTab,
    editorTextLength: streamState.editorText.length,
    statusHeadline: streamState.statusHeadline,
    statusDetail: streamState.statusDetail,
    lastStreamEvent,
  }, null, 2))

  await stopActiveStreamIfNeeded()
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    await stopActiveStreamIfNeeded().catch(() => undefined)
    app.exit(1)
  }
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})