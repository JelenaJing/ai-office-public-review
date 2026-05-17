import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

type DomState = {
  bodyText: string
  launcherTitle: string
  buttons: Array<{ text: string; disabled: boolean }>
}

const projectRoot = path.resolve(process.cwd())
const packagedResourcesPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources')
const packagedRendererPath = path.join(packagedResourcesPath, 'app.asar', 'dist', 'index.html')
const packagedPreloadPath = path.join(packagedResourcesPath, 'app.asar', 'dist-electron', 'preload', 'index.js')

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
  try {
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: packagedResourcesPath,
    })
  } catch {
    // Ignore if runtime disallows reassignment.
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
  }
}

function registerIpcHandlers(): void {
  const defaultSettings = getDefaultSettings()
  const knowledgeRoot = path.join(tempUserDataDir, 'knowledge-base')

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
  ipcMain.handle('suite:returnToLauncher', async () => ({ success: true }))
  ipcMain.handle('suite:launchCompanion', async (_event, appId) => ({
    success: true,
    message: `packaged smoke skipped launching companion app: ${String(appId || '')}`,
  }))
  ipcMain.handle('introRemake:listRecentTasks', async () => [])
  ipcMain.handle('workspace:list', async () => [])
  ipcMain.handle('workspace:create', async () => ({ path: '' }))
  ipcMain.handle('workspace:register', async () => ({ path: '' }))
  ipcMain.handle('workspace:tree', async () => [])
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('knowledge:getInfo', async () => ({
    rootPath: knowledgeRoot,
    documentCount: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }))
  ipcMain.handle('knowledge:listDocuments', async () => [])
  ipcMain.handle('knowledge:getDocument', async () => null)
}

async function readDomState(): Promise<DomState> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }

  return mainWindow.webContents.executeJavaScript(`(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    return {
      bodyText: normalize(document.body?.innerText),
      launcherTitle: normalize(document.querySelector('h1')?.textContent),
      buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
        text: normalize(button.textContent),
        disabled: Boolean(button.disabled),
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

async function waitForText(text: string, timeoutMs: number): Promise<DomState> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    throwIfRendererFailed()
    const state = await readDomState()
    if (state.bodyText.includes(text)) {
      return state
    }
    await sleep(150)
  }

  const finalState = await readDomState().catch(() => null)
  throw new Error(`[smoke] timed out waiting for text: ${text}\n${JSON.stringify({ finalState, consoleErrors, pageErrors }, null, 2)}`)
}

async function clickButton(buttonText: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
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

async function createSmokeWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: packagedPreloadPath,
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
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    pageErrors.push(`preload error at ${preloadPath}: ${String(error)}`)
  })

  await mainWindow.loadFile(packagedRendererPath)
}

async function run(): Promise<void> {
  ensureFileExists(packagedRendererPath, 'packaged renderer bundle')
  ensureFileExists(packagedPreloadPath, 'packaged preload bundle')

  patchPackagedRuntime()
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-packaged-knowledge-smoke-'))
  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers()
  await createSmokeWindow()

  const suiteState = await waitForText('选择产品入口', 15000)
  if (!suiteState.buttons.some((button) => button.text === '进入 Knowledge Library')) {
    throw new Error(`[smoke] launcher did not render Knowledge Library button\n${JSON.stringify(suiteState, null, 2)}`)
  }
  await clickButton('进入 Knowledge Library')

  const knowledgeState = await waitForText('Knowledge Library', 15000)
  if (!knowledgeState.buttons.some((button) => button.text === '返回启动器')) {
    throw new Error(`[smoke] knowledge library view is missing return action\n${JSON.stringify(knowledgeState, null, 2)}`)
  }
  if (!knowledgeState.buttons.some((button) => button.text === '进入 3.0 工作台')) {
    throw new Error(`[smoke] knowledge library view is missing writer entry action\n${JSON.stringify(knowledgeState, null, 2)}`)
  }

  await clickButton('返回启动器')
  const returnState = await waitForText('选择产品入口', 15000)
  if (!returnState.buttons.some((button) => button.text === '进入 Knowledge Library')) {
    throw new Error(`[smoke] launcher did not recover after returning from knowledge library\n${JSON.stringify(returnState, null, 2)}`)
  }

  console.log('[smoke] packaged knowledge-library launcher flow ok')
  console.log(JSON.stringify({
    launcherTitle: suiteState.launcherTitle,
    knowledgeTitle: knowledgeState.launcherTitle,
    buttonCount: returnState.buttons.length,
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

app.on('window-all-closed', (event) => {
  event.preventDefault()
})