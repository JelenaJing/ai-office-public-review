import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { app, BrowserWindow, ipcMain, type Event } from 'electron'
import { KnowledgeService } from '../electron/main/services/knowledgeService'
import { generatePptx, type PptxGenerateInput } from '../electron/main/services/pptxGenerator'

type DomState = {
  bodyText: string
  buttons: Array<{ text: string; disabled: boolean; title: string }>
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
let fixturePaths: string[] = []
let knowledgeService: KnowledgeService | null = null
let lastPptOutputPath = ''
let lastPptSlideCount = 0
let lastPptTemplateId = ''
let markdownTitle = ''
let docxTitle = ''
let imageTitle = ''

const consoleErrors: string[] = []
const pageErrors: string[] = []
const assistantPayloads: Array<Record<string, unknown>> = []

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

async function createPng(filePath: string): Promise<void> {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z8DwHwAFgwJ/lmw7JwAAAABJRU5ErkJggg=='
  await fsp.writeFile(filePath, Buffer.from(pngBase64, 'base64'))
}

async function createFixtures(baseDir: string): Promise<string[]> {
  const markdownPath = path.join(baseDir, '治理阶段要点.md')
  const docxPath = path.join(baseDir, '医疗数据治理模板.docx')
  const imagePath = path.join(baseDir, '治理流程图.png')

  await fsp.writeFile(markdownPath, [
    '# 治理阶段要点',
    '',
    '需要突出数据治理进展、审计留痕和下一步里程碑。',
  ].join('\n'), 'utf-8')

  await createDocx(docxPath, [
    '医疗数据治理模板',
    '该文档用于提供汇报结构与表达语气。',
    '正文建议覆盖现状、风险与行动建议。',
    '建议先交代治理目标与业务背景，再展开阶段进展。',
    '需要单独说明当前口径差异、权限边界和审计留痕现状。',
    '对于重点风险，建议对应写清影响范围、责任角色和缓解动作。',
    '若页面空间允许，可补充阶段里程碑与跨部门协同安排。',
    '结尾应强调下一季度的治理抓手、资源诉求和复盘机制。',
    '附录部分可以补充统一指标口径发布、培训计划和例外流程闭环。',
  ])

  await createPng(imagePath)
  return [markdownPath, docxPath, imagePath]
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

function buildPptPlan(): string {
  return JSON.stringify({
    title: '医疗数据治理季度汇报',
    theme: {
      primary: '1F3864',
      secondary: '2B579A',
      accent: '5BA3D9',
      light: 'D6E4F0',
      bg: 'FFFFFF',
    },
    slides: [
      { type: 'cover', title: '医疗数据治理季度汇报', subtitle: '季度经营与合规管理复盘' },
      { type: 'toc', title: '目录', items: ['治理进展', '风险概览', '行动计划'] },
      { type: 'section', heading: '治理进展', subtitle: '阶段成果与当前状态' },
      {
        type: 'metrics',
        heading: '治理概览',
        body: '本季度治理工作从制度落地进入闭环运营阶段，关键指标已具备经营汇报价值。',
        metrics: [
          { value: '3', label: '已统一核心口径', detail: '主数据、权限、审计三条主线完成收敛' },
          { value: '87%', label: '重点流程覆盖率', detail: '较上季提升 12 个百分点' },
          { value: '12项', label: '已完成治理动作', detail: '覆盖标准、权限、留痕和台账' },
          { value: 'Q2', label: '下一阶段目标', detail: '进入跨系统审计闭环' },
        ],
      },
      {
        type: 'comparison',
        heading: '主要风险与对应动作',
        leftTitle: '当前风险',
        leftItems: ['跨系统口径仍有差异', '少量历史数据缺少责任归属', '部分接口审批链路较长'],
        rightTitle: '对应动作',
        rightItems: ['完成指标口径清洗与统一发布', '补齐历史数据责任台账', '压缩审批路径并上线提醒机制'],
      },
      {
        type: 'timeline',
        heading: '推进节奏',
        timeline: [
          { title: 'Q1 标准统一', detail: '完成核心数据口径与字段映射收敛' },
          { title: 'Q2 审计留痕', detail: '上线全链路授权审计与责任回溯' },
          { title: 'Q3 权限收敛', detail: '推进高风险权限分级治理' },
          { title: 'Q4 复盘闭环', detail: '建立季度复盘与例外追踪机制' },
        ],
      },
      {
        type: 'content',
        heading: '下一步重点',
        body: '后续重点将从“完成动作”转向“稳定闭环”和“经营可视化”。',
        items: ['完成指标口径清洗', '推进全链路授权审计', '建立季度复盘机制'],
      },
      {
        type: 'summary',
        heading: '管理层结论',
        body: '治理基础已经具备复盘与扩面条件，下一阶段应转入制度化运营。',
        items: ['治理框架已成型', '风险已明确可落地动作', '具备下一阶段扩面条件'],
      },
    ],
  })
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
    path: path.join(String(parentDir || tempUserDataDir), String(name || 'smoke-ppt-workspace')),
    name: String(name || 'smoke-ppt-workspace'),
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
  ipcMain.handle('workspace:tree', async () => [])
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('workspace:detectProjectStructure', async () => ({ isProject: true, hasFigures: true }))
  ipcMain.handle('workspace:createFolder', async (_event, wsPathArg, relativePath) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(relativePath || '')) }))
  ipcMain.handle('workspace:createFile', async (_event, wsPathArg, relativePath) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(relativePath || '')) }))
  ipcMain.handle('workspace:createBlankDocument', async (_event, wsPathArg, relativePath) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(relativePath || '')) }))
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
  ipcMain.handle('knowledge:saveTaskRecord', async () => ({ task: { id: 'ppt-smoke-task' } }))
  ipcMain.handle('knowledge:createRemakeVersion', async () => ({ document: null, version: null, task: null }))
  ipcMain.handle('knowledge:setCurrentVersion', async () => ({ document: null, version: null }))
  ipcMain.handle('knowledge:submitRemakeTask', async () => ({ success: true }))
  ipcMain.handle('knowledge:importDocuments', async () => ({ ...(await knowledgeService!.importDocuments(fixturePaths)), canceled: false }))
  ipcMain.handle('knowledge:importDocumentFromPath', async (_event, filePath) => ({ ...(await knowledgeService!.importDocuments([String(filePath || '')])), canceled: false }))
  ipcMain.handle('knowledge:classifyDocument', async () => null)
  ipcMain.handle('knowledge:updateDocumentCategory', async () => undefined)

  ipcMain.handle('documentEngine:getActive', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:setPreferred', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:readOoxmlPackage', async () => ({ filePath: '', exists: false, entryCount: 0, entries: [], contentTypesXml: null, documentXml: null, paragraphCount: 0, paragraphs: [], blockCount: 0, blocks: [], plainText: '', html: '' }))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || ''), paragraphCount: 0, entryCount: 0, created: true }))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:read', async () => ({ type: 'txt', content: '', filePath: '' }))
  ipcMain.handle('file:listDirectoryImages', async () => [])
  ipcMain.handle('file:importImage', async () => null)
  ipcMain.handle('file:readImageAsDataUrl', async (event, filePathArg) => ({ filePath: String(filePathArg || ''), fileName: path.basename(String(filePathArg || 'image.png')), contentType: 'image/png', dataUrl: `data:image/png;base64,${(await fsp.readFile(String(filePathArg || ''))).toString('base64')}` }))
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
  ipcMain.handle('ai:writingAssistant', async (_event, payload) => {
    const normalized = { ...((payload || {}) as Record<string, unknown>) }
    assistantPayloads.push(normalized)
    return buildPptPlan()
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

  ipcMain.handle('pptx:generate', async (_event, payload) => {
    const result = await generatePptx((payload || {}) as PptxGenerateInput)
    if (result.success) {
      lastPptOutputPath = result.outputPath
      lastPptSlideCount = result.slideCount
      lastPptTemplateId = String(result.templateId || '')
    }
    return result
  })
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

async function clickButtonByTitle(buttonTitle: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.getAttribute('title')) === ${JSON.stringify(buttonTitle)})
    if (!button) throw new Error('Button not found by title: ' + ${JSON.stringify(buttonTitle)})
    if (button.disabled) throw new Error('Button is disabled: ' + ${JSON.stringify(buttonTitle)})
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

async function clickTextContaining(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const candidates = Array.from(document.querySelectorAll('body *')).filter((node) => normalize(node.textContent).includes(${JSON.stringify(text)}))
    const target = candidates.sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length)[0] || null
    if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
    target.click()
  })()`)
}

async function setComposerInput(value: string): Promise<void> {
  await executeInRenderer(`(() => {
    const input = document.querySelector('textarea')
    if (!input) throw new Error('Composer input not found')
    input.focus()
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    descriptor?.set?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
}

async function clickKnowledgeAction(title: string, actionTexts: string[]): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const wantedActions = ${JSON.stringify(actionTexts)}.map(normalize)
    const buttons = Array.from(document.querySelectorAll('button'))
    const control = buttons.find((button) => {
      const buttonText = normalize(button.textContent)
      if (!wantedActions.includes(buttonText)) return false
      let current = button
      while (current) {
        if (normalize(current.textContent).includes(${JSON.stringify(title)})) {
          return true
        }
        current = current.parentElement
      }
      return false
    }) || null
    if (!control) throw new Error('Knowledge control not found for: ' + ${JSON.stringify(title)} + ' / ' + wantedActions.join(', '))
    control.click()
  })()`)
}

async function toggleKnowledgeReference(title: string): Promise<void> {
  await clickKnowledgeAction(title, ['加入本轮素材', '加入本轮', '加入参考'])
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

  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-ppt-ui-smoke-'))
  workspacePath = path.join(tempUserDataDir, 'workspaces', 'smoke-ppt-workspace')
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
  const importedDocuments = await knowledgeService.listDocuments()
  markdownTitle = importedDocuments.find((item) => item.sourceType === 'md')?.title || ''
  docxTitle = importedDocuments.find((item) => item.sourceType === 'docx')?.title || ''
  imageTitle = importedDocuments.find((item) => item.sourceType === 'image')?.title || ''
  if (!markdownTitle || !docxTitle || !imageTitle) {
    throw new Error('[smoke] failed to resolve imported knowledge titles')
  }

  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers([
    {
      name: 'smoke-ppt-workspace',
      path: workspacePath,
      hasDocument: false,
      modifiedAt: '2026-04-09T08:00:00.000Z',
    },
  ])

  await createSmokeWindow()

  const initialState = await waitForCondition(
    (state) => state.bodyText.includes('进入 3.0 工作台') || state.bodyText.includes('smoke-ppt-workspace'),
    'app shell ready',
    15000,
  )
  if (initialState.bodyText.includes('进入 3.0 工作台')) {
    await clickButton('进入 3.0 工作台')
    await waitForText('smoke-ppt-workspace', 15000)
  }
  await clickTextContaining('smoke-ppt-workspace')
  await waitForCondition(
    (state) => state.bodyText.includes('当前工作区: smoke-ppt-workspace') || !state.bodyText.includes('当前工作区: 未限定工作区'),
    'workspace activation',
    15000,
  )
  await waitForText('文稿', 15000)
  await clickButton('PPT')
  await waitForText('PPT预览主区', 15000)

  await toggleKnowledgeReference(markdownTitle)
  await toggleKnowledgeReference(docxTitle)
  await toggleKnowledgeReference(imageTitle)
  await waitForCondition(
    (state) => state.bodyText.includes('已选素材') && state.bodyText.includes('3'),
    'ppt selected knowledge count',
    10000,
  )

  await setComposerInput('基于当前知识资料生成一份管理层汇报 PPT，突出治理进展、主要风险和下一步行动。')
  await clickButtonByTitle('开始PPT生成')
  await waitForText('PPT 已生成', 20000)
  await waitForText('打开 PPT', 10000)
  await waitForText('医疗数据治理季度汇报（共 8 页）', 10000)

  await waitForMainProcessCondition(() => assistantPayloads.length >= 1, 'assistant payload', 5000)
  await waitForMainProcessCondition(() => Boolean(lastPptOutputPath), 'ppt output path', 10000)

  const assistantPayload = assistantPayloads[0] || {}
  const instruction = String(assistantPayload.instruction || '')
  if (!instruction.includes(markdownTitle) || !instruction.includes(docxTitle) || !instruction.includes(imageTitle)) {
    throw new Error('[smoke] assistant instruction missing selected knowledge titles')
  }
  if (!instruction.includes('管理层汇报 PPT')) {
    throw new Error('[smoke] assistant instruction missing user prompt')
  }
  if (!instruction.includes('主内容 Word') || !instruction.includes('该文档用于提供汇报结构与表达语气') || !instruction.includes('正文建议覆盖现状、风险与行动建议')) {
    throw new Error('[smoke] assistant instruction is not driven by selected Word content')
  }
  if (!instruction.includes('附录部分可以补充统一指标口径发布、培训计划和例外流程闭环')) {
    throw new Error('[smoke] assistant instruction still truncates later Word paragraphs')
  }
  if (!instruction.includes('适度扩写') || !instruction.includes('不得编造新的具体事实')) {
    throw new Error('[smoke] assistant instruction missing controlled expansion guidance')
  }

  if (!lastPptOutputPath.endsWith('.pptx')) {
    throw new Error(`[smoke] expected pptx output, got ${lastPptOutputPath}`)
  }
  const stat = await fsp.stat(lastPptOutputPath)
  if (stat.size <= 0) {
    throw new Error('[smoke] generated pptx file is empty')
  }
  if (lastPptSlideCount !== 8) {
    throw new Error(`[smoke] expected 8 slides, got ${lastPptSlideCount}`)
  }
  if (lastPptTemplateId !== 'cuhk_sz_default') {
    throw new Error(`[smoke] expected default ppt template cuhk_sz_default, got ${lastPptTemplateId || '<empty>'}`)
  }

  const zip = await JSZip.loadAsync(await fsp.readFile(lastPptOutputPath))
  const slideEntries = Object.keys(zip.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
  const masterEntries = Object.keys(zip.files).filter((entry) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(entry))
  const layoutEntries = Object.keys(zip.files).filter((entry) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(entry))
  const mediaEntries = Object.keys(zip.files).filter((entry) => /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(entry))
  if (slideEntries.length !== 8) {
    throw new Error(`[smoke] expected 8 slide xml files, got ${slideEntries.length}`)
  }
  if (masterEntries.length === 0) {
    throw new Error('[smoke] expected generated pptx to include at least one slide master')
  }
  if (mediaEntries.length < 3) {
    throw new Error(`[smoke] expected generated pptx to include template background/logo and content images, got ${mediaEntries.length} media files`)
  }

  const presentationXml = await zip.file('ppt/presentation.xml')?.async('text')
  if (!presentationXml || !presentationXml.includes('cx="12192000"') || !presentationXml.includes('cy="6858000"')) {
    throw new Error('[smoke] generated pptx does not inherit the template slide size (12192000 x 6858000)')
  }

  let layoutImageRelCount = 0
  for (let index = 1; index <= layoutEntries.length; index += 1) {
    const relXml = await zip.file(`ppt/slideLayouts/_rels/slideLayout${index}.xml.rels`)?.async('text')
    layoutImageRelCount += (relXml?.match(/relationships\/image/g) || []).length
  }
  if (layoutImageRelCount < 1) {
    throw new Error(`[smoke] expected slide layouts to reference the template background asset, got ${layoutImageRelCount} image relationships`)
  }

  let slideImageRelCount = 0
  for (let index = 1; index <= slideEntries.length; index += 1) {
    const relXml = await zip.file(`ppt/slides/_rels/slide${index}.xml.rels`)?.async('text')
    slideImageRelCount += (relXml?.match(/relationships\/image/g) || []).length
  }
  if (slideImageRelCount < 6) {
    throw new Error(`[smoke] expected generated slides to include repeated logo/content image relationships, got ${slideImageRelCount}`)
  }

  console.log(JSON.stringify({
    workspacePath,
    selectedKnowledgeTitles: [markdownTitle, docxTitle, imageTitle],
    assistantPayloadHasKnowledge: true,
    outputPath: lastPptOutputPath,
    templateId: lastPptTemplateId,
    slideCount: lastPptSlideCount,
    masterEntries,
    layoutEntries,
    layoutImageRelCount,
    mediaEntries,
    slideEntries,
    slideImageRelCount,
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