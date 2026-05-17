import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { app, BrowserWindow, ipcMain } from 'electron'
import { KnowledgeService } from '../electron/main/services/knowledgeService'

type DomState = {
  bodyText: string
  launcherTitle: string
  buttons: Array<{ text: string; disabled: boolean; title: string }>
}

type WorkspaceInfo = {
  name: string
  path: string
  hasDocument: boolean
  modifiedAt: string
}

const projectRoot = path.resolve(process.cwd())
const packagedResourcesPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources')
const packagedRendererPath = path.join(packagedResourcesPath, 'app.asar', 'dist', 'index.html')
const packagedPreloadPath = path.join(packagedResourcesPath, 'app.asar', 'dist-electron', 'preload', 'index.js')

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

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let knowledgeRoot = ''
let workspacePath = ''
let fixturePaths: string[] = []
let knowledgeService: KnowledgeService | null = null
const consoleErrors: string[] = []
const pageErrors: string[] = []

process.on('uncaughtException', (error) => {
  console.error('[smoke] uncaughtException', error)
})

process.on('unhandledRejection', (error) => {
  console.error('[smoke] unhandledRejection', error)
})

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

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
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

async function createFixtures(baseDir: string): Promise<string[]> {
  const markdownPath = path.join(baseDir, '医疗数据治理模板.md')
  const txtPath = path.join(baseDir, '监管合规要点.txt')
  const docxPath = path.join(baseDir, '季度治理原稿.docx')

  await fsp.writeFile(markdownPath, [
    '# 医疗数据治理模板',
    '',
    '## 执行摘要',
    '模板用于沉淀治理报告的章节结构与表达节奏。',
    '',
    '## 风险与建议',
    '请围绕数据质量、权限矩阵和审计留痕组织报告。',
  ].join('\n'), 'utf-8')

  await fsp.writeFile(txtPath, [
    '监管合规要点',
    '需要统一审批编号、脱敏流程和访问授权台账。',
    '相关术语：数据血缘、权限矩阵、审计日志。',
  ].join('\n'), 'utf-8')

  await createDocx(docxPath, [
    '季度治理原稿',
    '该文档用于验证 KnowledgePanel UI 导入后可以作为参考资料被勾选。',
    '正文覆盖风险分析、接口稳定性和整改计划。',
  ])

  return [markdownPath, txtPath, docxPath]
}

function registerIpcHandlers(workspaces: WorkspaceInfo[]): void {
  const defaultSettings = getDefaultSettings()

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
    success: true,
    path: path.join(String(parentDir || tempUserDataDir), String(name || 'smoke-workspace')),
    name: String(name || 'smoke-workspace'),
  }))
  ipcMain.handle('workspace:register', async (_event, wsPath) => ({
    success: true,
    path: String(wsPath || workspacePath),
    name: path.basename(String(wsPath || workspacePath)),
  }))
  ipcMain.handle('workspace:tree', async () => [])
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('workspace:detectProjectStructure', async () => ({ isProject: true, hasFigures: false }))
  ipcMain.handle('workspace:readReferences', async () => ({ references: [] }))
  ipcMain.handle('workspace:saveReferences', async (_event, _wsPath, references) => ({
    success: true,
    total: Array.isArray(references) ? references.length : 0,
  }))
  ipcMain.handle('workspace:appendReferences', async (_event, _wsPath, references) => ({
    success: true,
    total: Array.isArray(references) ? references.length : 0,
  }))
  ipcMain.handle('workspace:writeFile', async (_event, wsPathArg, relativePath) => ({
    success: true,
    path: path.join(String(wsPathArg || workspacePath), String(relativePath || 'output.txt')),
  }))
  ipcMain.handle('workspace:readDocumentSchema', async () => null)
  ipcMain.handle('workspace:writeDocumentSchema', async () => ({ success: true }))
  ipcMain.handle('workspace:saveImageFromUrl', async (_event, wsPathArg, _imageUrl, filename) => ({
    success: true,
    path: path.join(String(wsPathArg || workspacePath), String(filename || 'figure.png')),
    relativePath: String(filename || 'figure.png'),
    filename: String(filename || 'figure.png'),
  }))
  ipcMain.handle('workspace:saveImageToFigures', async (_event, wsPathArg, _imageUrl, filename) => ({
    success: true,
    path: path.join(String(wsPathArg || workspacePath), 'figures', String(filename || 'figure.png')),
    relativePath: path.join('figures', String(filename || 'figure.png')),
    filename: String(filename || 'figure.png'),
  }))
  ipcMain.handle('workspace:saveImageToWorkspace', async (_event, wsPathArg, filename) => ({
    success: true,
    path: path.join(String(wsPathArg || workspacePath), String(filename || 'figure.png')),
    relativePath: String(filename || 'figure.png'),
    filename: String(filename || 'figure.png'),
  }))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async (_event, wsPathArg, filename) => ({
    success: true,
    path: path.join(String(wsPathArg || workspacePath), 'figures', String(filename || 'figure.png')),
    relativePath: path.join('figures', String(filename || 'figure.png')),
    filename: String(filename || 'figure.png'),
  }))

  ipcMain.handle('knowledge:getInfo', async () => knowledgeService!.getInfo())
  ipcMain.handle('knowledge:listDocuments', async (_event, query) => knowledgeService!.listDocuments(typeof query === 'string' ? query : undefined))
  ipcMain.handle('knowledge:getDocument', async (_event, documentId) => knowledgeService!.getDocument(String(documentId || '')))
  ipcMain.handle('knowledge:getDocumentVersion', async (_event, documentId, versionId) => knowledgeService!.getDocumentVersion(String(documentId || ''), String(versionId || '')))
  ipcMain.handle('knowledge:deleteDocument', async (_event, documentId) => knowledgeService!.deleteDocument(String(documentId || '')))
  ipcMain.handle('knowledge:saveTaskRecord', async (_event, payload) => knowledgeService!.saveTaskRecord((payload || {}) as any))
  ipcMain.handle('knowledge:createRemakeVersion', async (_event, payload) => knowledgeService!.createRemakeVersion((payload || {}) as any))
  ipcMain.handle('knowledge:setCurrentVersion', async (_event, documentId, versionId) => knowledgeService!.setCurrentVersion(String(documentId || ''), String(versionId || '')))
  ipcMain.handle('knowledge:submitRemakeTask', async () => {
    throw new Error('knowledge remake is not part of this UI smoke')
  })
  ipcMain.handle('knowledge:importDocuments', async () => {
    const imported = await knowledgeService!.importDocuments(fixturePaths)
    return {
      ...imported,
      canceled: false,
    }
  })

  ipcMain.handle('compat:getActiveTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:getRecentTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:getTaskStatus', async () => ({ status: 'success', task: null }))
  ipcMain.handle('compat:getTaskResult', async () => ({ status: 'success', result: null }))
  ipcMain.handle('compat:pauseTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:resumeTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:stopTask', async () => ({ status: 'success' }))
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

async function clickButton(buttonText: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  try {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.textContent) === ${JSON.stringify(buttonText)})
      if (!button) throw new Error('Button not found: ' + ${JSON.stringify(buttonText)})
      if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(buttonText)})
      button.click()
    })()`, true)
  } catch (error) {
    throw new Error(`[smoke] clickButton failed for ${buttonText}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function clickButtonByTitle(buttonTitle: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  try {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.getAttribute('title')) === ${JSON.stringify(buttonTitle)})
      if (!button) throw new Error('Button title not found: ' + ${JSON.stringify(buttonTitle)})
      if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(buttonTitle)})
      button.click()
    })()`, true)
  } catch (error) {
    throw new Error(`[smoke] clickButtonByTitle failed for ${buttonTitle}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function clickText(text: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  try {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const target = Array.from(document.querySelectorAll('body *')).find((node) => normalize(node.textContent) === ${JSON.stringify(text)})
      if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
      ;(target).click()
    })()`, true)
  } catch (error) {
    throw new Error(`[smoke] clickText failed for ${text}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function clickTextContaining(text: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  try {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const target = Array.from(document.querySelectorAll('body *')).find((node) => normalize(node.textContent).includes(${JSON.stringify(text)}))
      if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
      ;(target).click()
    })()`, true)
  } catch (error) {
    throw new Error(`[smoke] clickTextContaining failed for ${text}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function clickDocumentAction(documentTitle: string, actionTitle: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  try {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const card = Array.from(document.querySelectorAll('[data-testid^="knowledge-document-card-"]')).find((node) => normalize(node.textContent).includes(${JSON.stringify(documentTitle)}))
      if (!card) throw new Error('Document card not found: ' + ${JSON.stringify(documentTitle)})
      const target = Array.from(card.querySelectorAll('button')).find((node) => {
        const label = normalize(node.getAttribute('aria-label'))
        const title = normalize(node.getAttribute('title'))
        return label === ${JSON.stringify(`${actionTitle}：${documentTitle}`)} || title === ${JSON.stringify(actionTitle)}
      })
      if (!target) throw new Error('Document action not found: ' + ${JSON.stringify(`${actionTitle}：${documentTitle}`)})
      if (target instanceof HTMLButtonElement && target.disabled) throw new Error('Document action is disabled: ' + ${JSON.stringify(`${actionTitle}：${documentTitle}`)})
      ;(target).click()
    })()`, true)
  } catch (error) {
    throw new Error(`[smoke] clickDocumentAction failed for ${documentTitle} / ${actionTitle}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function setInputByPlaceholder(placeholderText: string, value: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }
  try {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const input = Array.from(document.querySelectorAll('input, textarea')).find((node) => String(node.getAttribute('placeholder') || '').includes(${JSON.stringify(placeholderText)}))
      if (!input) throw new Error('Input not found for placeholder: ' + ${JSON.stringify(placeholderText)})
      input.focus()
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      descriptor?.set?.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`, true)
  } catch (error) {
    throw new Error(`[smoke] setInputByPlaceholder failed for ${placeholderText}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function createSmokeWindow(): Promise<void> {
  console.log('[smoke] creating browser window')
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
      console.error('[smoke] renderer console', String(message))
    }
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    pageErrors.push(`render process gone: ${details.reason}`)
    console.error('[smoke] render-process-gone', details.reason)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    pageErrors.push(`did-fail-load ${code}: ${description}`)
    console.error('[smoke] did-fail-load', code, description)
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    pageErrors.push(`preload error at ${preloadPath}: ${String(error)}`)
    console.error('[smoke] preload-error', preloadPath, error)
  })

  await mainWindow.loadFile(packagedRendererPath)
  console.log('[smoke] packaged renderer loaded')
}

async function run(): Promise<void> {
  console.log('[smoke] run started')
  ensureFileExists(packagedRendererPath, 'packaged renderer bundle')
  ensureFileExists(packagedPreloadPath, 'packaged preload bundle')

  patchPackagedRuntime()
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-packaged-knowledge-ui-smoke-'))
  workspacePath = path.join(tempUserDataDir, 'workspaces', 'smoke-knowledge-workspace')
  knowledgeRoot = path.join(tempUserDataDir, 'knowledge-base')
  const fixturesDir = path.join(tempUserDataDir, 'fixtures')
  await fsp.mkdir(fixturesDir, { recursive: true })
  await fsp.mkdir(workspacePath, { recursive: true })
  fixturePaths = await createFixtures(fixturesDir)
  knowledgeService = new KnowledgeService(knowledgeRoot)
  await knowledgeService.initialize()

  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers([])
  console.log('[smoke] ipc handlers registered')
  await createSmokeWindow()

  const initialState = await waitForCondition(
    (state) => state.bodyText.includes('新建文章') && state.bodyText.includes('打开已有文章目录'),
    'writer shell ready',
    15000,
  )
  if (!initialState.bodyText.includes('新建文章')) {
    throw new Error(`[smoke] writer shell did not enter no-workspace state\n${JSON.stringify(initialState, null, 2)}`)
  }
  await setInputByPlaceholder('输入新文章名称', '知识库烟测文章')
  await clickButton('创建文章目录')
  await waitForCondition(
    (state) => state.bodyText.includes('返回选择工作区') || state.bodyText.includes('当前工作区文件树'),
    'workspace created',
    20000,
  )
  await clickButton('资料库')
  await waitForCondition(
    (state) => state.bodyText.includes('知识库模板区') && state.buttons.some((button) => button.title === '导入知识文档'),
    'embedded knowledge dock',
    20000,
  )
  console.log('[smoke] entered writer workspace knowledge dock')
  await clickButtonByTitle('导入知识文档')
  console.log('[smoke] triggered import from embedded knowledge dock')

  await waitForCondition((state) => (
    state.bodyText.includes('医疗数据治理模板')
    && state.bodyText.includes('监管合规要点')
    && state.bodyText.includes('季度治理原稿')
  ), 'knowledge documents imported into panel', 20000)

  await clickDocumentAction('季度治理原稿', '设为模板')
  console.log('[smoke] selected template document in embedded knowledge dock')
  await waitForCondition((state) => (
    state.bodyText.includes('当前模板：季度治理原稿')
  ), 'template selection state', 10000)

  await clickDocumentAction('监管合规要点', '勾选为参考资料')
  console.log('[smoke] added first reference document')
  await waitForCondition((state) => (
    state.bodyText.includes('参考资料')
    && state.bodyText.includes('1')
  ), 'first reference selection state', 10000)

  await clickDocumentAction('医疗数据治理模板', '勾选为参考资料')
  console.log('[smoke] added second reference document')
  await waitForCondition((state) => (
    state.bodyText.includes('当前模板：季度治理原稿')
    && state.bodyText.includes('监管合规要点')
    && state.bodyText.includes('医疗数据治理模板')
  ), 'second reference selection state', 10000)

  await clickButtonByTitle('刷新知识库')
  console.log('[smoke] refreshed knowledge panel state')
  const refreshedState = await waitForCondition((state) => (
    state.bodyText.includes('当前模板：季度治理原稿')
    && state.bodyText.includes('监管合规要点')
    && state.bodyText.includes('医疗数据治理模板')
  ), 'selection state after refresh', 10000)

  await clickButton('仅看已选')
  const selectedState = await waitForCondition((state) => (
    state.bodyText.includes('本轮已选资料 / 风格图')
    && state.bodyText.includes('季度治理原稿')
    && state.bodyText.includes('监管合规要点')
    && state.bodyText.includes('医疗数据治理模板')
  ), 'selected-only knowledge list', 10000)

  console.log('[smoke] packaged embedded knowledge dock import and selection flow ok')
  console.log(JSON.stringify({
    importedCount: 3,
    workspacePath,
    refreshedHasTemplate: refreshedState.bodyText.includes('当前模板：季度治理原稿'),
    refreshedHasTwoReferences: refreshedState.bodyText.includes('监管合规要点') && refreshedState.bodyText.includes('医疗数据治理模板'),
    selectedOnlyViewHasAllSelections: selectedState.bodyText.includes('季度治理原稿') && selectedState.bodyText.includes('监管合规要点') && selectedState.bodyText.includes('医疗数据治理模板'),
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