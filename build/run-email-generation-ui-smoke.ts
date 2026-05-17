import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { KnowledgeService } from '../electron/main/services/knowledgeService'
import type { KnowledgeDocumentDetail, KnowledgeDocumentMeta, KnowledgeLibraryInfo } from '../src/types/knowledge'

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

type FileTreeNode = {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'folder'
  size?: number
  children?: FileTreeNode[]
}

const projectRoot = path.resolve(process.cwd())
const rendererPath = path.join(projectRoot, 'dist', 'index.html')
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload', 'index.js')

const TEMPLATE_DOC_NAME = '项目推进邮件回复模板'
const TEMPLATE_CARD_TITLE = '项目推进正式回复'
const SECONDARY_TEMPLATE_DOC_NAME = '学术补充说明回复模板'
const SECONDARY_TEMPLATE_TITLE = '学术补充说明回复'
const HEURISTIC_TEMPLATE_DOC_NAME = '旧版邮件模板提示'
const HEURISTIC_TEMPLATE_TITLE = '旧版提示模板'
const REFERENCE_DOC_NAME = '科研报销补充口径'
const TARGET_MAIL_SUBJECT = '科研经费报销材料需补充'
const UNIQUE_REFERENCE_PHRASE = '本周内可先提交电子版，纸质签字件随后补交'

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let workspacePath = ''
let knowledgeRoot = ''
let fixturePaths: string[] = []
let knowledgeService: KnowledgeService | null = null
let cachedKnowledgeInfo: KnowledgeLibraryInfo | null = null
let cachedKnowledgeDocuments: KnowledgeDocumentMeta[] = []
let cachedKnowledgeDetails = new Map<string, KnowledgeDocumentDetail>()
let referenceDocumentId = ''
let lastSavedDraftPath = ''

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

async function buildFileTree(targetDir: string, rootDir = targetDir): Promise<FileTreeNode[]> {
  const entries = await fsp.readdir(targetDir, { withFileTypes: true })
  const results = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(targetDir, entry.name)
    const relativePath = path.relative(rootDir, entryPath) || entry.name
    if (entry.isDirectory()) {
      return {
        name: entry.name,
        path: entryPath,
        relativePath,
        type: 'folder' as const,
        children: await buildFileTree(entryPath, rootDir),
      }
    }

    const stat = await fsp.stat(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      relativePath,
      type: 'file' as const,
      size: stat.size,
    }
  }))

  return results.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

async function createFixtures(baseDir: string, activeWorkspacePath: string): Promise<string[]> {
  const templatePath = path.join(baseDir, `${TEMPLATE_DOC_NAME}.md`)
  const secondaryTemplatePath = path.join(baseDir, `${SECONDARY_TEMPLATE_DOC_NAME}.md`)
  const heuristicTemplatePath = path.join(baseDir, `${HEURISTIC_TEMPLATE_DOC_NAME}.md`)
  const referencePath = path.join(baseDir, `${REFERENCE_DOC_NAME}.md`)
  const inboxDir = path.join(activeWorkspacePath, '01_Input')
  const inboxPath = path.join(inboxDir, 'mock_email_inbox.json')

  await fsp.mkdir(inboxDir, { recursive: true })
  await fsp.writeFile(templatePath, [
    '---',
    'templateType: email_reply',
    'templateTitle: 项目推进正式回复',
    'templateSummary: 适合对外确认排期、回传材料与责任边界的正式邮件回复。',
    'templateCategory: 项目推进',
    'templateTone: 正式、稳妥、清晰',
    'templateSubjectStrategy: keep-original',
    'templateDefault: true',
    'templatePriority: 80',
    'templateSignature: |',
    '  此致',
    '  敬礼',
    '  项目推进办公室',
    '---',
    '',
    '开场：',
    '感谢来信，我们已根据当前项目安排梳理需要同步的重点，并整理如下回复。',
    '',
    '结尾：',
    '如需我们补充附件或调整回传节奏，请直接说明，我们会继续配合推进。',
  ].join('\n'), 'utf-8')

  await fsp.writeFile(secondaryTemplatePath, [
    'templateType: email_reply',
    `标题：${SECONDARY_TEMPLATE_TITLE}`,
    '摘要：适合审稿意见、实验补充和逐项答复场景。',
    '模板类别：学术回复',
    '语气：严谨、克制、回应具体问题',
    '主题策略：custom-prefix',
    '主题前缀：答复：',
    '模板优先级：40',
    '',
    '开场：',
    '感谢审阅意见，我们已根据问题逐项整理一版补充说明。',
    '',
    '结尾：',
    '如果还需要补充实验细节，我们会继续完善。',
    '',
    '签名：',
    '祝好',
    '作者团队',
  ].join('\n'), 'utf-8')

  await fsp.writeFile(heuristicTemplatePath, [
    '# 旧版提示模板',
    '',
    '这个旧版邮件模板主要用于历史兼容，仍然保留“邮件模板”字样用于启发式识别。',
    '',
    '开场：邮件收到，我们先按旧版格式整理一版简短回复。',
    '结尾：如需调整，请继续告知。',
  ].join('\n'), 'utf-8')

  await fsp.writeFile(referencePath, [
    '# 科研报销补充口径',
    '',
    '- 差旅报销补件建议先补出差审批表，再补行程说明。',
    '- 设备采购金额超过 5000 元时，需要同步提交验收报告。',
    `- ${UNIQUE_REFERENCE_PHRASE}。`,
  ].join('\n'), 'utf-8')

  await fsp.writeFile(inboxPath, JSON.stringify([
    {
      id: 'workspace-mail-1',
      from: 'pm@partner.example.com',
      to: 'team@ai-office.example.com',
      cc: ['director@ai-office.example.com'],
      subject: '请确认下周汇报材料回传安排',
      date: '2026-04-09 10:30',
      body: '各位同事好，\n\n请确认下周汇报材料的回传安排，并在今天下班前给我一版可对外同步的正式回复。\n\n另外请说明本次数据口径是否继续沿用上周版本，如有差异请在邮件中单独标注。\n\n谢谢。',
      attachments: ['上周汇报口径说明.pdf'],
    },
  ], null, 2), 'utf-8')

  return [templatePath, secondaryTemplatePath, heuristicTemplatePath, referencePath]
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
    path: path.join(String(parentDir || tempUserDataDir), String(name || 'smoke-email-workspace')),
    name: String(name || 'smoke-email-workspace'),
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
  ipcMain.handle('workspace:tree', async (_event, wsPathArg) => buildFileTree(String(wsPathArg || workspacePath)))
  ipcMain.handle('workspace:delete', async () => ({ success: true }))
  ipcMain.handle('workspace:detectProjectStructure', async () => ({ isProject: true, hasFigures: true }))
  ipcMain.handle('workspace:createFolder', async (_event, wsPathArg, relativePath) => {
    const target = path.join(String(wsPathArg || workspacePath), String(relativePath || ''))
    await fsp.mkdir(target, { recursive: true })
    return { success: true, path: target }
  })
  ipcMain.handle('workspace:createFile', async (_event, wsPathArg, relativePath) => {
    const target = path.join(String(wsPathArg || workspacePath), String(relativePath || 'new.txt'))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, '', 'utf-8')
    return { success: true, path: target }
  })
  ipcMain.handle('workspace:createBlankDocument', async (_event, wsPathArg, relativePath) => ({ success: true, path: path.join(String(wsPathArg || workspacePath), String(relativePath || '')) }))
  ipcMain.handle('workspace:renamePath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:copyPath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:movePath', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:deletePath', async () => ({ success: true }))
  ipcMain.handle('workspace:readReferences', async () => ({ references: [] }))
  ipcMain.handle('workspace:readTaskHistory', async () => ({ tasks: [] }))
  ipcMain.handle('workspace:appendTaskHistory', async () => ({ success: true, total: 0 }))
  ipcMain.handle('workspace:saveReferences', async (_event, _wsPath, references) => ({ success: true, total: Array.isArray(references) ? references.length : 0 }))
  ipcMain.handle('workspace:appendReferences', async (_event, _wsPath, references) => ({ success: true, total: Array.isArray(references) ? references.length : 0 }))
  ipcMain.handle('workspace:saveImageToWorkspace', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:saveImageFromUrl', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:saveImageToFigures', async () => ({ success: true, path: '', relativePath: '', filename: '' }))
  ipcMain.handle('workspace:writeFile', async (_event, wsPathArg, relativePath, content) => {
    const target = path.join(String(wsPathArg || workspacePath), String(relativePath || 'output.txt'))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, String(content || ''), 'utf-8')
    if (/06_Email_Drafts\//.test(String(relativePath || ''))) {
      lastSavedDraftPath = target
    }
    return { success: true, path: target }
  })
  ipcMain.handle('workspace:saveManuscript', async () => ({ success: true, path: '' }))
  ipcMain.handle('workspace:saveExperimentPlan', async () => ({ success: true, path: '' }))

  ipcMain.handle('knowledge:getInfo', async () => cachedKnowledgeInfo)
  ipcMain.handle('knowledge:listDocuments', async (_event, query) => {
    const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
    if (!needle) return cachedKnowledgeDocuments
    return cachedKnowledgeDocuments.filter((document) => {
      const haystack = `${document.title}\n${document.originalName}\n${document.previewText}`.toLowerCase()
      return haystack.includes(needle)
    })
  })
  ipcMain.handle('knowledge:getDocument', async (_event, documentId) => cachedKnowledgeDetails.get(String(documentId || '').trim()) || null)
  ipcMain.handle('knowledge:getDocumentVersion', async (_event, documentId, versionId) => knowledgeService!.getDocumentVersion(String(documentId || ''), String(versionId || '')))
  ipcMain.handle('knowledge:listDocumentChunks', async () => [])
  ipcMain.handle('knowledge:retrieveChunks', async () => ({ hits: [], citations: [] }))
  ipcMain.handle('knowledge:previewTaskContext', async () => ({ explicitReferenceSummaries: [], retrievedHits: [], citations: [] }))
  ipcMain.handle('knowledge:materializeWorkspace', async () => ({ success: true, workspacePath, name: path.basename(workspacePath), documentPath: '', fileName: '', sourceCount: 0 }))
  ipcMain.handle('knowledge:deleteDocument', async (_event, documentId) => knowledgeService!.deleteDocument(String(documentId || '')))
  ipcMain.handle('knowledge:saveTaskRecord', async () => ({ task: { id: 'email-smoke-task' } }))
  ipcMain.handle('knowledge:createRemakeVersion', async () => ({ document: null, version: null, task: null }))
  ipcMain.handle('knowledge:setCurrentVersion', async () => ({ document: null, version: null }))
  ipcMain.handle('knowledge:submitRemakeTask', async () => ({ success: true }))
  ipcMain.handle('knowledge:importDocuments', async () => ({ ...(await knowledgeService!.importDocuments(fixturePaths)), canceled: false }))
  ipcMain.handle('knowledge:importDocumentFromPath', async (_event, filePathArg) => ({ ...(await knowledgeService!.importDocuments([String(filePathArg || '')])), canceled: false }))
  ipcMain.handle('knowledge:classifyDocument', async () => null)
  ipcMain.handle('knowledge:updateDocumentCategory', async () => undefined)

  ipcMain.handle('documentEngine:getActive', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:setPreferred', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:readOoxmlPackage', async () => ({ filePath: '', exists: false, entryCount: 0, entries: [], contentTypesXml: null, documentXml: null, paragraphCount: 0, paragraphs: [], blockCount: 0, blocks: [], plainText: '', html: '' }))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || ''), paragraphCount: 0, entryCount: 0, created: true }))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:read', async (_event, filePathArg) => {
    const targetPath = String(filePathArg || '').trim()
    const content = targetPath ? await fsp.readFile(targetPath, 'utf-8') : ''
    return {
      type: path.extname(targetPath).replace(/^\./, '') || 'txt',
      content,
      filePath: targetPath,
    }
  })
  ipcMain.handle('file:listDirectoryImages', async () => [])
  ipcMain.handle('file:importImage', async () => null)
  ipcMain.handle('file:readImageAsDataUrl', async () => ({ filePath: '', fileName: '', contentType: 'image/png', dataUrl: '' }))
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
  ipcMain.handle('pptx:generate', async () => ({ success: false }))
}

async function readDomState(): Promise<DomState> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('[smoke] browser window is not available')
  }

  return mainWindow.webContents.executeJavaScript(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const textareaText = Array.from(document.querySelectorAll('textarea'))
      .map((node) => normalize(node.value))
      .filter(Boolean)
      .join(' ')
    return {
      bodyText: [normalize(document.body?.innerText), textareaText].filter(Boolean).join(' '),
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

async function clickByTestId(testId: string): Promise<void> {
  await executeInRenderer(`(() => {
    const node = document.querySelector('[data-testid="' + ${JSON.stringify(testId)} + '"]')
    if (!node) throw new Error('Node not found by test id: ' + ${JSON.stringify(testId)})
    if (node.disabled) throw new Error('Node is disabled by test id: ' + ${JSON.stringify(testId)})
    node.click()
  })()`)
}

async function clickButtonByTitle(buttonTitle: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const button = Array.from(document.querySelectorAll('button')).find((node) => normalize(node.getAttribute('title')) === ${JSON.stringify(buttonTitle)})
    if (!button) throw new Error('Button not found by title: ' + ${JSON.stringify(buttonTitle)})
    if (button.disabled) throw new Error('Button is disabled by title: ' + ${JSON.stringify(buttonTitle)})
    button.click()
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

async function clickKnowledgeAction(title: string, actionText: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const candidates = Array.from(document.querySelectorAll('body *')).filter((node) => normalize(node.textContent) === ${JSON.stringify(title)})
    const containers = []
    for (const candidate of candidates) {
      let current = candidate
      while (current) {
        if (current.querySelector) {
          const buttons = Array.from(current.querySelectorAll('button'))
          const text = normalize(current.textContent)
          const hasAction = buttons.some((button) => normalize(button.textContent) === ${JSON.stringify(actionText)})
          if (text.includes(${JSON.stringify(title)}) && hasAction) {
            containers.push(current)
          }
        }
        current = current.parentElement
      }
    }
    const uniqueContainers = Array.from(new Set(containers))
    const container = uniqueContainers.sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length)[0] || null
    if (!container) throw new Error('Knowledge item container not found for: ' + ${JSON.stringify(title)})
    const control = Array.from(container.querySelectorAll('button')).find((button) => normalize(button.textContent) === ${JSON.stringify(actionText)}) || null
    if (!control) throw new Error('Knowledge control not found for: ' + ${JSON.stringify(actionText)})
    control.click()
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

  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-email-ui-smoke-'))
  workspacePath = path.join(tempUserDataDir, 'workspaces', 'smoke-email-workspace')
  knowledgeRoot = path.join(tempUserDataDir, 'knowledge-base')
  const fixturesDir = path.join(tempUserDataDir, 'fixtures')

  await fsp.mkdir(fixturesDir, { recursive: true })
  await fsp.mkdir(workspacePath, { recursive: true })
  fixturePaths = await createFixtures(fixturesDir, workspacePath)

  knowledgeService = new KnowledgeService(knowledgeRoot)
  await knowledgeService.initialize()
  const imported = await knowledgeService.importDocuments(fixturePaths)
  if (imported.imported.length !== 4) {
    throw new Error(`[smoke] expected 4 imported documents, got ${imported.imported.length}`)
  }
  cachedKnowledgeInfo = await knowledgeService.getInfo()
  cachedKnowledgeDocuments = await knowledgeService.listDocuments()
  cachedKnowledgeDetails = new Map((await Promise.all(
    cachedKnowledgeDocuments.map(async (document) => [document.id, await knowledgeService!.getDocument(document.id)] as const),
  )).filter((entry): entry is [string, KnowledgeDocumentDetail] => Boolean(entry[1])))
  referenceDocumentId = cachedKnowledgeDocuments.find((document) => document.title === REFERENCE_DOC_NAME)?.id || ''
  if (!referenceDocumentId) {
    throw new Error('[smoke] failed to resolve reference document id from imported knowledge fixtures')
  }

  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers([
    {
      name: 'smoke-email-workspace',
      path: workspacePath,
      hasDocument: false,
      modifiedAt: '2026-04-09T10:30:00.000Z',
    },
  ])

  await createSmokeWindow()

  const initialState = await waitForCondition(
    (state) => state.bodyText.includes('进入 3.0 工作台') || state.bodyText.includes('smoke-email-workspace'),
    'app shell ready',
    15000,
  )
  if (initialState.bodyText.includes('进入 3.0 工作台')) {
    await clickButton('进入 3.0 工作台')
    await waitForText('smoke-email-workspace', 15000)
  }

  await clickTextContaining('smoke-email-workspace')
  await waitForCondition(
    (state) => state.bodyText.includes('当前工作区: smoke-email-workspace') || !state.bodyText.includes('当前工作区: 未限定工作区'),
    'workspace activation',
    15000,
  )

  await clickButton('邮件')
  await waitForText('收件箱', 15000)
  await waitForText(TARGET_MAIL_SUBJECT, 10000)
  await clickTextContaining(TARGET_MAIL_SUBJECT)
  await waitForText('选择参考资料', 10000)

  await clickByTestId('email-reference-picker-button')
  await clickByTestId(`email-reference-option-${referenceDocumentId}`)
  await clickButton('完成')
  await waitForCondition((state) => state.bodyText.includes(REFERENCE_DOC_NAME), 'selected reference chip', 10000)

  await clickByTestId('email-generate-draft-button')
  await waitForCondition(
    (state) => state.bodyText.includes('AI 回复草稿') && state.bodyText.includes(UNIQUE_REFERENCE_PHRASE),
    'reference-driven draft output',
    15000,
  )

  const generatedState = await readDomState()
  if (!generatedState.bodyText.includes(UNIQUE_REFERENCE_PHRASE)) {
    throw new Error('[smoke] generated draft missing unique knowledge reference phrase')
  }
  if (!generatedState.bodyText.includes('另外，我会结合已勾选的知识资料同步以下要点')) {
    throw new Error('[smoke] generated draft missing knowledge-driven fallback paragraph')
  }

  console.log('[smoke] email generation ui flow ok')
  console.log(JSON.stringify({
    selectedMailSubject: TARGET_MAIL_SUBJECT,
    referenceTitle: REFERENCE_DOC_NAME,
    knowledgePhraseInjected: UNIQUE_REFERENCE_PHRASE,
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