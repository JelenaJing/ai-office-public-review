import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { app, BrowserWindow, ipcMain } from 'electron'
import { KnowledgeService } from '../electron/main/services/knowledgeService'

type DomState = {
  bodyText: string
  buttons: Array<{ text: string; disabled: boolean }>
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
let workspacePath = ''
let knowledgeRoot = ''
let fixturePaths: string[] = []
let knowledgeService: KnowledgeService | null = null
const consoleErrors: string[] = []
const pageErrors: string[] = []
const submitPayloads: Array<Record<string, any>> = []
const assistantPayloads: Array<Record<string, any>> = []
const savedKnowledgeTaskPayloads: Array<Record<string, any>> = []
const taskStateMap = new Map<string, { task: Record<string, any>; result: Record<string, any> }>()

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
  const markdownPath = path.join(baseDir, '医疗数据治理参考.md')
  const txtPath = path.join(baseDir, '监管合规要点.txt')
  const docxPath = path.join(baseDir, '医疗数据治理模板.docx')

  await fsp.writeFile(markdownPath, [
    '# 医疗数据治理参考',
    '',
    '## 监管背景',
    '这份文档作为知识库参考资料，提供治理项目的背景约束与术语说明。',
    '',
    '## 风险与建议',
    '建议围绕数据质量、权限矩阵和审计留痕组织补充说明。',
  ].join('\n'), 'utf-8')

  await fsp.writeFile(txtPath, [
    '监管合规要点',
    '需要统一审批编号、脱敏流程和访问授权台账。',
    '相关术语：数据血缘、权限矩阵、审计日志。',
  ].join('\n'), 'utf-8')

  await createDocx(docxPath, [
    '医疗数据治理模板',
    '该文档用于验证 composer 中选择知识库 Word 模板后，全文生成会继承其章节骨架与表达节奏。',
    '正文覆盖执行摘要、治理现状、风险分析与整改计划。',
  ])

  return [markdownPath, txtPath, docxPath]
}

function buildTaskResult(topic: string): Record<string, any> {
  const safeTopic = String(topic || '未命名主题').trim() || '未命名主题'
  return {
    paper_markdown: [
      `# ${safeTopic}`,
      '',
      '## 执行摘要',
      '本报告沿用任务级模板的章节骨架，并吸收任务级参考资料中的合规与治理要点。',
      '',
      '## 核心发现',
      '风险识别、权限矩阵和整改计划已经整合为同一份写作输出。',
    ].join('\n'),
    reference_list: [],
    images: [],
  }
}

function buildAssistantResult(topic: string): string {
  const safeTopic = String(topic || '未命名主题').trim() || '未命名主题'
  return [
    `# ${safeTopic}`,
    '',
    '## 执行摘要',
    '本次输出基于知识库 Word 模板的结构分析生成，不再走内置综述/研究论文模板。',
    '',
    '## 主体内容',
    '文本已综合模板风格、参考资料与当前用户指令，生成新的完整正文。',
  ].join('\n')
}

function buildPreviewTaskContext(payload: Record<string, any>): Record<string, any> {
  const instruction = String(payload?.instruction || '未命名主题')
  return {
    templateSummary: '模板摘要：沿用执行摘要、治理现状、风险分析与整改计划的章节组织。',
    retrievedHits: [],
    citations: [
      {
        documentId: 'smoke-reference-1',
        documentTitle: '监管合规要点',
        locatorLabel: '第 1 段',
        quote: `围绕 ${instruction} 需要统一审批编号、脱敏流程和访问授权台账。`,
        sourceKind: 'required-reference',
      },
      {
        documentId: 'smoke-reference-2',
        documentTitle: '医疗数据治理参考',
        locatorLabel: '风险与建议',
        quote: '建议围绕数据质量、权限矩阵和审计留痕组织补充说明。',
        sourceKind: 'required-reference',
      },
    ],
  }
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
  ipcMain.handle('knowledge:saveTaskRecord', async (_event, payload) => {
    const normalized = { ...((payload || {}) as Record<string, any>) }
    savedKnowledgeTaskPayloads.push(normalized)
    return knowledgeService!.saveTaskRecord(normalized as any)
  })
  ipcMain.handle('knowledge:previewTaskContext', async (_event, payload) => buildPreviewTaskContext((payload || {}) as Record<string, any>))
  ipcMain.handle('knowledge:createRemakeVersion', async (_event, payload) => knowledgeService!.createRemakeVersion((payload || {}) as any))
  ipcMain.handle('knowledge:setCurrentVersion', async (_event, documentId, versionId) => knowledgeService!.setCurrentVersion(String(documentId || ''), String(versionId || '')))
  ipcMain.handle('knowledge:submitRemakeTask', async () => {
    throw new Error('knowledge remake is not part of this composer smoke')
  })
  ipcMain.handle('knowledge:importDocuments', async () => ({
    ...(await knowledgeService!.importDocuments(fixturePaths)),
    canceled: false,
  }))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:openExternal', async (event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:write', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:writeDocx', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))

  ipcMain.handle('ai:writingAssistant', async (_event, payload) => {
    const normalized = { ...((payload || {}) as Record<string, any>) }
    assistantPayloads.push(normalized)
    return buildAssistantResult(String(normalized.instruction || '未命名主题'))
  })

  ipcMain.handle('compat:submitTask', async (_event, payload) => {
    const normalized = { ...((payload || {}) as Record<string, any>) }
    submitPayloads.push(normalized)
    const taskId = `composer-smoke-task-${submitPayloads.length}`
    const result = buildTaskResult(String(normalized.topic || '未命名主题'))
    taskStateMap.set(taskId, {
      task: {
        task_id: taskId,
        status: 'completed',
        status_message: '论文生成已完成',
        current_content: result.paper_markdown,
      },
      result,
    })
    return {
      status: 'success',
      task_id: taskId,
    }
  })
  ipcMain.handle('compat:getTaskStatus', async (_event, taskId) => ({
    status: 'success',
    task: taskStateMap.get(String(taskId || ''))?.task || null,
  }))
  ipcMain.handle('compat:getTaskResult', async (_event, taskId) => ({
    status: 'success',
    result: taskStateMap.get(String(taskId || ''))?.result || null,
  }))
  ipcMain.handle('compat:getActiveTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:getRecentTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:pauseTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:resumeTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:stopTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:findCitationForText', async () => ({ status: 'success', citations: [] }))
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

async function clickExactText(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const target = Array.from(document.querySelectorAll('body *')).find((node) => normalize(node.textContent) === ${JSON.stringify(text)})
    if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
    target.click()
  })()`)
}

async function openContextMenuOnEditor(): Promise<void> {
  await executeInRenderer(`(() => {
    const editor = document.querySelector('[contenteditable="true"]')
    if (!editor) throw new Error('Editor not found')
    const rect = editor.getBoundingClientRect()
    editor.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.max(80, rect.left + 32),
      clientY: Math.max(80, rect.top + 32),
    }))
  })()`)
}

async function setComposerInput(value: string): Promise<void> {
  await executeInRenderer(`(() => {
    const input = Array.from(document.querySelectorAll('textarea, input')).find((node) => {
      const placeholder = String(node.getAttribute('placeholder') || '')
      return placeholder.includes('输入新的报告主题') || placeholder.includes('输入全文生成或改写指令')
    })
    if (!input) throw new Error('Composer input not found')
    input.focus()
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
}

async function setKnowledgeControl(title: string, selector: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const candidates = Array.from(document.querySelectorAll('body *')).filter((node) => normalize(node.textContent) === ${JSON.stringify(title)})
    const containers = []
    for (const candidate of candidates) {
      let current = candidate
      while (current) {
        if (current.querySelector && current.querySelector(${JSON.stringify(selector)})) {
          const text = normalize(current.textContent)
          if (text.includes(${JSON.stringify(title)})) {
            containers.push(current)
          }
        }
        current = current.parentElement
      }
    }
    const uniqueContainers = Array.from(new Set(containers))
    const container = uniqueContainers.sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length)[0] || null
    if (!container) throw new Error('Knowledge item container not found for: ' + ${JSON.stringify(title)})
    const control = container.querySelector(${JSON.stringify(selector)})
    if (!control) throw new Error('Knowledge control not found for: ' + ${JSON.stringify(title)})
    control.click()
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
}

async function chooseKnowledgeTemplate(title: string): Promise<void> {
  await setKnowledgeControl(title, 'input[type="radio"]')
}

async function toggleKnowledgeReference(title: string): Promise<void> {
  await setKnowledgeControl(title, 'input[type="checkbox"]')
}

async function createSmokeWindow(): Promise<void> {
  console.log('[smoke] creating browser window')
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
    console.error('[smoke] render-process-gone', details.reason)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    pageErrors.push(`did-fail-load ${code}: ${description}`)
    console.error('[smoke] did-fail-load', code, description)
  })
  mainWindow.webContents.on('preload-error', (_event, targetPath, error) => {
    pageErrors.push(`preload error at ${targetPath}: ${String(error)}`)
    console.error('[smoke] preload-error', targetPath, error)
  })

  await mainWindow.loadFile(rendererPath)
  console.log('[smoke] renderer loaded from current build')
}

async function run(): Promise<void> {
  console.log('[smoke] run started')
  ensureFileExists(rendererPath, 'renderer build')
  ensureFileExists(preloadPath, 'preload build')

  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-composer-knowledge-smoke-'))
  workspacePath = path.join(tempUserDataDir, 'workspaces', 'smoke-demo-workspace')
  knowledgeRoot = path.join(tempUserDataDir, 'knowledge-base')
  const fixturesDir = path.join(tempUserDataDir, 'fixtures')
  await fsp.mkdir(fixturesDir, { recursive: true })
  await fsp.mkdir(workspacePath, { recursive: true })
  fixturePaths = await createFixtures(fixturesDir)

  knowledgeService = new KnowledgeService(knowledgeRoot)
  await knowledgeService.initialize()
  const imported = await knowledgeService.importDocuments(fixturePaths)
  if (imported.imported.length !== 3) {
    throw new Error(`[smoke] expected 3 imported documents, got ${imported.imported.length}`)
  }

  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers([
    {
      name: 'smoke-demo-workspace',
      path: workspacePath,
      hasDocument: false,
      modifiedAt: '2026-04-05T13:40:00.000Z',
    },
  ])
  console.log('[smoke] ipc handlers registered')

  await createSmokeWindow()

  await waitForText('进入 3.0 工作台', 15000)
  await clickButton('进入 3.0 工作台')
  await waitForText('smoke-demo-workspace', 15000)
  await clickExactText('smoke-demo-workspace')
  await waitForText('+ 新建文档', 15000)
  console.log('[smoke] entered writer workspace')

  await clickButton('+ 新建文档')
  await waitForCondition((state) => state.bodyText.includes('未命名文档'), 'new document tab', 15000)
  await waitForCondition((state) => state.bodyText.includes('AI补全: 关'), 'writer status bar', 15000)
  await executeInRenderer(`document.querySelector('[contenteditable="true"]') !== null`)
  console.log('[smoke] opened new document')

  await openContextMenuOnEditor()
  await waitForText('一键生成全文', 10000)
  await clickExactText('✨ 一键生成全文')
  await waitForText('选择知识库中的 Word 模板', 10000)
  console.log('[smoke] opened generation composer')

  await clickButton('选择知识库中的 Word 模板')
  await waitForText('本次全文生成模板与资料', 10000)
  await chooseKnowledgeTemplate('医疗数据治理模板')
  await toggleKnowledgeReference('监管合规要点')
  await toggleKnowledgeReference('医疗数据治理参考')
  await waitForText('本次全文 Word 模板：医疗数据治理模板', 10000)
  await waitForText('参考资料 2 份', 10000)
  console.log('[smoke] selected word template and references')

  await setComposerInput('新能源项目进展报告')
  await clickButton('发送')
  await waitForText('模板驱动全文已生成完成', 20000)
  console.log('[smoke] submitted composer generation')

  await waitForMainProcessCondition(() => assistantPayloads.length >= 1, 'assistant payload', 5000)
  await waitForMainProcessCondition(() => savedKnowledgeTaskPayloads.some((item) => item.status === 'completed'), 'completed knowledge task record', 10000)

  if (submitPayloads.length > 0) {
    throw new Error('[smoke] template-driven generation should not submit compat paper tasks')
  }

  const assistantPayload = assistantPayloads[0] || {}
  const extraContext = String(assistantPayload.extraContext || '')
  if (assistantPayload.generationMode !== 'knowledge-template-document') {
    throw new Error(`[smoke] assistant payload should use knowledge-template-document mode, got ${String(assistantPayload.generationMode || '')}`)
  }
  if (!extraContext.includes('监管合规要点') || !extraContext.includes('医疗数据治理参考')) {
    throw new Error('[smoke] assistant payload missing reference titles')
  }
  if (!assistantPayload.templateDocument || String(assistantPayload.templateDocument.title || '') !== '医疗数据治理模板') {
    throw new Error('[smoke] assistant payload missing selected word template')
  }
  if (!String(assistantPayload.templateDocument.extractedText || '').includes('医疗数据治理模板')) {
    throw new Error('[smoke] assistant payload missing template extracted text')
  }

  const documents = await knowledgeService.listDocuments()
  const templateDocument = documents.find((item) => item.title === '医疗数据治理模板')
  const referenceDocuments = documents.filter((item) => item.title === '监管合规要点' || item.title === '医疗数据治理参考')
  if (!templateDocument || referenceDocuments.length !== 2) {
    throw new Error('[smoke] failed to resolve imported knowledge documents for verification')
  }

  const completedRecord = savedKnowledgeTaskPayloads.find((item) => item.status === 'completed')
  if (!completedRecord) {
    throw new Error('[smoke] completed knowledge task record was not saved')
  }
  if (completedRecord.templateDocumentId !== templateDocument.id) {
    throw new Error(`[smoke] completed task template mismatch: ${completedRecord.templateDocumentId} !== ${templateDocument.id}`)
  }

  const normalizedReferenceIds = Array.isArray(completedRecord.referenceDocumentIds)
    ? completedRecord.referenceDocumentIds.map((value: unknown) => String(value))
    : []
  const expectedReferenceIds = referenceDocuments.map((item) => item.id).sort()
  if (normalizedReferenceIds.slice().sort().join(',') !== expectedReferenceIds.join(',')) {
    throw new Error(`[smoke] completed task reference mismatch: ${normalizedReferenceIds.join(',')} !== ${expectedReferenceIds.join(',')}`)
  }

  console.log('[smoke] composer task-level knowledge generation flow ok')
  console.log(JSON.stringify({
    submitTopic: assistantPayload.instruction,
    templateDrivenMode: assistantPayload.generationMode,
    extraContextHasReferences: extraContext.includes('监管合规要点') && extraContext.includes('医疗数据治理参考'),
    usedCompatPaperTask: submitPayloads.length > 0,
    completedTaskRecord: {
      status: completedRecord.status,
      templateDocumentId: completedRecord.templateDocumentId,
      referenceDocumentIds: normalizedReferenceIds,
    },
    savedTaskRecordCount: savedKnowledgeTaskPayloads.length,
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