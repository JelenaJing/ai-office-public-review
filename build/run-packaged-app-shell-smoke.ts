import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

type WorkspaceInfo = {
  name: string
  path: string
  hasDocument: boolean
  modifiedAt: string
}

type DomState = {
  bodyText: string
  launcherTitle: string
  noticeText: string
  buttons: Array<{ text: string; disabled: boolean }>
  workspaceCards: string[]
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
    // Ignore if Electron runtime marks it non-configurable in this environment.
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
    },
    backendUrl: '',
  }
}

function registerIpcHandlers(workspaces: WorkspaceInfo[]): void {
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
  ipcMain.handle('workspace:list', async () => workspaces)
  ipcMain.handle('workspace:create', async (_event, name, parentDir) => ({
    path: path.join(String(parentDir || tempUserDataDir), String(name || 'smoke-workspace')),
  }))
  ipcMain.handle('workspace:register', async (_event, wsPath) => ({
    path: String(wsPath || workspaces[0]?.path || tempUserDataDir),
  }))
  ipcMain.handle('workspace:tree', async () => [])
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('knowledge:getInfo', async () => ({
    rootPath: knowledgeRoot,
    documentCount: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }))
  ipcMain.handle('knowledge:listDocuments', async () => [])
}

async function readDomState(): Promise<DomState> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }

  return mainWindow.webContents.executeJavaScript(`(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const buttons = Array.from(document.querySelectorAll('button')).map((button) => ({
      text: normalize(button.textContent),
      disabled: Boolean(button.disabled),
    }))
    const workspaceCards = buttons
      .map((button) => button.text)
      .filter((text) => text && text !== '进入 3.0 工作台' && text !== '进入 Remake' && text !== '创建并进入工作区' && text !== '打开已有工作区目录')

    return {
      bodyText: normalize(document.body?.innerText),
      launcherTitle: normalize(document.querySelector('h1')?.textContent),
      noticeText: normalize(document.querySelector('p')?.textContent),
      buttons,
      workspaceCards,
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
  mainWindow.webContents.on('unresponsive', () => {
    pageErrors.push('window became unresponsive')
  })

  await mainWindow.loadFile(packagedRendererPath)
}

async function run(): Promise<void> {
  ensureFileExists(packagedRendererPath, 'packaged renderer bundle')
  ensureFileExists(packagedPreloadPath, 'packaged preload bundle')

  patchPackagedRuntime()
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-packaged-app-smoke-'))
  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  const workspacePath = path.join(tempUserDataDir, 'workspaces', 'smoke-demo-workspace')
  const workspaces: WorkspaceInfo[] = [
    {
      name: 'smoke-demo-workspace',
      path: workspacePath,
      hasDocument: false,
      modifiedAt: '2026-04-01T12:34:00.000Z',
    },
  ]

  registerIpcHandlers(workspaces)
  await createSmokeWindow()

  const suiteState = await waitForText('选择产品入口', 15000)
  console.log('[smoke] packaged suite launcher mounted')
  console.log(JSON.stringify({
    launcherTitle: suiteState.launcherTitle,
    primaryButtons: suiteState.buttons.filter((button) => button.text === '进入 3.0 工作台' || button.text === '进入 Remake'),
  }, null, 2))

  await clickButton('进入 3.0 工作台')

  const workspaceState = await waitForText('选择工作区', 15000)
  if (!workspaceState.bodyText.includes('已有工作区')) {
    throw new Error(`[smoke] workspace chooser did not render expected section\n${JSON.stringify(workspaceState, null, 2)}`)
  }
  if (workspaceState.workspaceCards.length === 0) {
    throw new Error(`[smoke] packaged workspace list did not render any workspace card\n${JSON.stringify(workspaceState, null, 2)}`)
  }

  console.log('[smoke] packaged writer launcher mounted')
  console.log(JSON.stringify({
    launcherTitle: workspaceState.launcherTitle,
    workspaceCards: workspaceState.workspaceCards,
    noticeText: workspaceState.noticeText,
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