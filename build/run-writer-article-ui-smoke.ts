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
  buttons: Array<{ text: string; disabled: boolean; title: string }>
}

type CompatTaskState = {
  id: string
  topic: string
  workspacePath?: string
  pollCount: number
  title: string
  markdown: string
  references: Array<Record<string, unknown>>
  imagePath: string
}

const projectRoot = path.resolve(process.cwd())
const uiSmokeMode = process.env.AI_WRITER_UI_SMOKE_MODE === 'packaged' ? 'packaged' : 'current'
const packagedResourcesPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources')
const packagedRendererPath = path.join(packagedResourcesPath, 'app.asar', 'dist', 'index.html')
const packagedPreloadPath = path.join(packagedResourcesPath, 'app.asar', 'dist-electron', 'preload', 'index.js')
const rendererPath = uiSmokeMode === 'packaged' ? packagedRendererPath : path.join(projectRoot, 'dist', 'index.html')
const preloadPath = uiSmokeMode === 'packaged' ? packagedPreloadPath : path.join(projectRoot, 'dist-electron', 'preload', 'index.js')

let mainWindow: BrowserWindow | null = null
let tempUserDataDir = ''
let workspaceRootDir = ''
let fixtureImagePath = ''
const consoleErrors: string[] = []
const pageErrors: string[] = []
const compatTasks = new Map<string, CompatTaskState>()
const createdWorkspacePaths: string[] = []
const workspaceRegistry = new Set<string>()

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

function normalizeFileLikePath(source: string): string {
  const value = String(source || '').trim()
  if (!value) return value
  if (value.startsWith('file://')) {
    try {
      return decodeURI(new URL(value).pathname)
    } catch {
      return decodeURI(value.replace(/^file:\/\//, ''))
    }
  }
  return decodeURI(value)
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

async function renameWorkspaceLocal(wsPath: string, nextName: string): Promise<{ success: boolean; path: string; name: string }> {
  const resolved = path.resolve(wsPath)
  const targetPath = await ensureUniqueTargetPath(path.join(path.dirname(resolved), sanitizeWorkspaceName(nextName, path.basename(resolved))))
  if (targetPath !== resolved) {
    await fsp.rename(resolved, targetPath)
    workspaceRegistry.delete(resolved)
    workspaceRegistry.add(targetPath)
  }
  return { success: true, path: targetPath, name: path.basename(targetPath) }
}

async function getWorkspaceTreeLocal(rootPath: string, currentPath = rootPath): Promise<Array<{ name: string; path: string; relativePath: string; type: 'file' | 'folder'; size?: number; children?: any[] }>> {
  const entries = await fsp.readdir(currentPath, { withFileTypes: true })
  const nodes = await Promise.all(entries.filter((entry) => !entry.name.startsWith('.')).map(async (entry) => {
    const absolutePath = path.join(currentPath, entry.name)
    const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      return { name: entry.name, path: absolutePath, relativePath, type: 'folder' as const, children: await getWorkspaceTreeLocal(rootPath, absolutePath) }
    }
    return { name: entry.name, path: absolutePath, relativePath, type: 'file' as const, size: (await fsp.stat(absolutePath)).size }
  }))
  return nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

function resolveReferenceArtifactPaths(wsPath: string, documentPath?: string): { jsonPath: string; textPath: string } {
  const normalizedDocumentPath = String(documentPath || '').trim()
  if (!normalizedDocumentPath) {
    return {
      jsonPath: path.join(wsPath, 'references.json'),
      textPath: path.join(wsPath, 'References_List.txt'),
    }
  }
  const absoluteDocumentPath = path.isAbsolute(normalizedDocumentPath) ? path.resolve(normalizedDocumentPath) : path.resolve(wsPath, normalizedDocumentPath)
  const directory = path.dirname(absoluteDocumentPath)
  const extension = path.extname(absoluteDocumentPath)
  const baseName = path.basename(absoluteDocumentPath, extension)
  return {
    jsonPath: path.join(directory, `${baseName}.references.json`),
    textPath: path.join(directory, `${baseName}.references.txt`),
  }
}

function referenceIdentity(reference: any): string {
  if (typeof reference === 'string') return reference.trim()
  const doi = String(reference?.doi || '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  const title = String(reference?.title || reference?.citation || '').trim().toLowerCase()
  const year = String(reference?.year || '').trim()
  return `title:${title}|year:${year}`
}

function formatReferenceLine(reference: any, index: number): string {
  if (typeof reference === 'string') return `${index + 1}. ${reference}`
  const authors = Array.isArray(reference?.authors) ? reference.authors.slice(0, 4).join(', ') : ''
  const year = reference?.year || 'n.d.'
  const title = reference?.title || reference?.citation || 'Untitled'
  const journal = reference?.journal ? ` ${reference.journal}.` : ''
  const doi = reference?.doi ? ` DOI: ${reference.doi}` : ''
  return `${index + 1}. ${(authors || 'Unknown Authors')} (${year}). ${title}.${journal}${doi}`.trim()
}

async function readReferencesLocal(wsPath: string, documentPath?: string): Promise<{ references: unknown[] }> {
  const targetPath = resolveReferenceArtifactPaths(wsPath, documentPath).jsonPath
  if (!(await pathExists(targetPath))) return { references: [] }
  try {
    const raw = await fsp.readFile(targetPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return { references: Array.isArray(parsed) ? parsed : [] }
  } catch {
    return { references: [] }
  }
}

async function saveReferencesLocal(wsPath: string, references: unknown[], documentPath?: string): Promise<{ success: boolean; total: number }> {
  const artifacts = resolveReferenceArtifactPaths(wsPath, documentPath)
  const normalized = Array.from(new Map((Array.isArray(references) ? references : []).map((item) => [referenceIdentity(item), item])).values())
  const textContent = normalized.map((item, index) => formatReferenceLine(item, index)).join('\n\n')
  await ensureDir(path.dirname(artifacts.jsonPath))
  await fsp.writeFile(artifacts.jsonPath, JSON.stringify(normalized, null, 2), 'utf-8')
  await fsp.writeFile(artifacts.textPath, `${textContent}${textContent ? '\n' : ''}`, 'utf-8')
  return { success: true, total: normalized.length }
}

async function appendReferencesLocal(wsPath: string, references: unknown[], documentPath?: string): Promise<{ success: boolean; total: number }> {
  const existing = await readReferencesLocal(wsPath, documentPath)
  return saveReferencesLocal(wsPath, [...(existing.references || []), ...(Array.isArray(references) ? references : [])], documentPath)
}

async function saveImageFromUrlLocal(wsPath: string, imageUrl: string, filename?: string): Promise<{ success: boolean; path: string; relativePath: string; filename: string }> {
  const targetDir = path.join(wsPath, 'pic')
  await ensureDir(targetDir)
  const finalName = filename || path.basename(imageUrl) || `image-${Date.now()}.png`
  const targetPath = await ensureUniqueTargetPath(path.join(targetDir, finalName))
  await fsp.copyFile(normalizeFileLikePath(imageUrl), targetPath)
  const savedName = path.basename(targetPath)
  return { success: true, path: targetPath, relativePath: `pic/${savedName}`, filename: savedName }
}

async function saveImageBase64Local(wsPath: string, filename: string, base64Data: string): Promise<{ success: boolean; path: string; relativePath: string; filename: string }> {
  const targetDir = path.join(wsPath, 'pic')
  await ensureDir(targetDir)
  const targetPath = await ensureUniqueTargetPath(path.join(targetDir, filename))
  await fsp.writeFile(targetPath, Buffer.from(base64Data, 'base64'))
  const savedName = path.basename(targetPath)
  return { success: true, path: targetPath, relativePath: `pic/${savedName}`, filename: savedName }
}

async function saveManuscriptLocal(wsPath: string, content: string, filename: string): Promise<{ success: boolean; path: string }> {
  const targetPath = path.join(wsPath, filename)
  await ensureDir(path.dirname(targetPath))
  await fsp.writeFile(targetPath, content, 'utf-8')
  return { success: true, path: targetPath }
}

async function deleteWorkspaceLocal(wsPath: string): Promise<{ success: boolean }> {
  await fsp.rm(wsPath, { recursive: true, force: true })
  workspaceRegistry.delete(path.resolve(wsPath))
  return { success: true }
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

function buildTaskState(topic: string, workspacePath?: string): CompatTaskState {
  const title = '多模态医学影像大模型在临床辅助诊断中的应用综述'
  const markdown = [
    `# ${title}`,
    '',
    '## 摘要',
    `本文围绕 ${String(topic || '未命名主题')} 展开，系统梳理多模态医学影像大模型在临床辅助诊断中的应用进展。`,
    '',
    '## 方法与应用',
    '正文包含图像相关结论、参考文献占位与可落盘的图片资源，用于验证 UI 生成完成后的目录产物。',
  ].join('\n')
  return {
    id: `writer-article-smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    topic,
    workspacePath,
    pollCount: 0,
    title,
    markdown,
    references: [
      { title: 'Clinical multimodal foundation model', citation: 'Clinical multimodal foundation model', year: 2025, doi: '10.1000/alpha' },
      { title: 'Large vision-language model for diagnosis', citation: 'Large vision-language model for diagnosis', year: 2024, doi: '10.1000/beta' },
    ],
    imagePath: fixtureImagePath,
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

async function clickExactText(text: string): Promise<void> {
  await executeInRenderer(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const target = Array.from(document.querySelectorAll('body *')).find((node) => normalize(node.textContent) === ${JSON.stringify(text)})
    if (!target) throw new Error('Text node not found: ' + ${JSON.stringify(text)})
    target.click()
  })()`)
}

async function setInputByPlaceholder(placeholderText: string, value: string): Promise<void> {
  await executeInRenderer(`(() => {
    const input = Array.from(document.querySelectorAll('input, textarea')).find((node) => String(node.getAttribute('placeholder') || '').includes(${JSON.stringify(placeholderText)}))
    if (!input) throw new Error('Input not found for placeholder: ' + ${JSON.stringify(placeholderText)})
    input.focus()
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
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

async function createFixtureImage(filePath: string): Promise<void> {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oNcamQAAAAASUVORK5CYII='
  await fsp.writeFile(filePath, Buffer.from(pngBase64, 'base64'))
}

function registerIpcHandlers(): void {
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
  ipcMain.handle('suite:launchCompanion', async (_event, appId) => ({ success: true, mode: 'launched', message: `smoke skipped launching companion app: ${String(appId || '')}` }))
  ipcMain.handle('introRemake:listRecentTasks', async () => [])
  ipcMain.handle('knowledge:getInfo', async () => ({ rootPath: path.join(tempUserDataDir, 'knowledge-base'), documentCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  ipcMain.handle('knowledge:listDocuments', async () => [])
  ipcMain.handle('documentEngine:getActive', async () => ({ engineId: 'legacy-tiptap-bridge', availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:setPreferred', async (_event, engineId) => ({ engineId: String(engineId || 'legacy-tiptap-bridge'), availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'] }))
  ipcMain.handle('documentEngine:readOoxmlPackage', async () => ({ filePath: '', exists: false, entryCount: 0, entries: [], contentTypesXml: null, documentXml: null, paragraphCount: 0, paragraphs: [], blockCount: 0, blocks: [], plainText: '', html: '' }))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_event, filePathArg) => ({ success: false, filePath: String(filePathArg || ''), paragraphCount: 0, entryCount: 0, created: false }))
  ipcMain.handle('settings:testLlm', async () => 'ok')
  ipcMain.handle('settings:testImage', async () => 'ok')

  ipcMain.handle('workspace:list', async () => listWorkspacesLocal())
  ipcMain.handle('workspace:create', async (_event, name, parentDir) => {
    const result = await createWorkspaceLocal(String(name || ''), parentDir ? String(parentDir) : undefined)
    createdWorkspacePaths.push(result.path)
    return result
  })
  ipcMain.handle('workspace:rename', async (_event, wsPath, nextName) => renameWorkspaceLocal(String(wsPath), String(nextName)))
  ipcMain.handle('workspace:register', async (_event, wsPath) => registerWorkspaceLocal(String(wsPath || '')))
  ipcMain.handle('workspace:tree', async (_event, wsPath) => getWorkspaceTreeLocal(String(wsPath || '')))
  ipcMain.handle('workspace:delete', async (_event, wsPath) => deleteWorkspaceLocal(String(wsPath || '')))
  ipcMain.handle('workspace:detectProjectStructure', async (_event, wsPath) => ({ isProject: true, hasFigures: false, workspacePath: String(wsPath || '') }))
  ipcMain.handle('workspace:createFolder', async (_event, wsPath, relativePath) => {
    const targetPath = path.join(String(wsPath), String(relativePath))
    await ensureDir(targetPath)
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:createFile', async (_event, wsPath, relativePath) => {
    const targetPath = path.join(String(wsPath), String(relativePath))
    await ensureDir(path.dirname(targetPath))
    await fsp.writeFile(targetPath, '', 'utf-8')
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:createBlankDocument', async (_event, wsPath, relativePath) => {
    const targetPath = path.join(String(wsPath), String(relativePath).replace(/\.docx$/i, '') + '.docx')
    await ensureDir(path.dirname(targetPath))
    await fsp.writeFile(targetPath, '', 'utf-8')
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:renamePath', async (_event, wsPath, oldRelativePath, newRelativePath) => {
    const oldPath = path.join(String(wsPath), String(oldRelativePath))
    const newPath = path.join(String(wsPath), String(newRelativePath))
    await ensureDir(path.dirname(newPath))
    await fsp.rename(oldPath, newPath)
    return { success: true, path: newPath }
  })
  ipcMain.handle('workspace:copyPath', async (_event, wsPath, sourceRelativePath, targetRelativePath) => {
    const sourcePath = path.join(String(wsPath), String(sourceRelativePath))
    const targetPath = await ensureUniqueTargetPath(path.join(String(wsPath), String(targetRelativePath)))
    await ensureDir(path.dirname(targetPath))
    await fsp.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true })
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:movePath', async (_event, wsPath, sourceRelativePath, targetRelativePath) => {
    const sourcePath = path.join(String(wsPath), String(sourceRelativePath))
    const targetPath = await ensureUniqueTargetPath(path.join(String(wsPath), String(targetRelativePath)))
    await ensureDir(path.dirname(targetPath))
    await fsp.rename(sourcePath, targetPath)
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:deletePath', async (_event, wsPath, relativePath) => {
    await fsp.rm(path.join(String(wsPath), String(relativePath)), { recursive: true, force: true })
    return { success: true }
  })
  ipcMain.handle('workspace:readReferences', async (_event, wsPath, documentPath) => readReferencesLocal(String(wsPath), documentPath ? String(documentPath) : undefined))
  ipcMain.handle('workspace:saveReferences', async (_event, wsPath, references, documentPath) => saveReferencesLocal(String(wsPath), Array.isArray(references) ? references : [], documentPath ? String(documentPath) : undefined))
  ipcMain.handle('workspace:appendReferences', async (_event, wsPath, references, documentPath) => appendReferencesLocal(String(wsPath), Array.isArray(references) ? references : [], documentPath ? String(documentPath) : undefined))
  ipcMain.handle('workspace:saveImageFromUrl', async (_event, wsPath, imageUrl, filename) => saveImageFromUrlLocal(String(wsPath), String(imageUrl), filename ? String(filename) : undefined))
  ipcMain.handle('workspace:saveImageToFigures', async (_event, wsPath, imageUrl, filename) => saveImageFromUrlLocal(String(wsPath), String(imageUrl), filename ? String(filename) : undefined))
  ipcMain.handle('workspace:saveImageToWorkspace', async (_event, wsPath, filename, base64Data) => saveImageBase64Local(String(wsPath), String(filename), String(base64Data)))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async (_event, wsPath, filename, base64Data) => saveImageBase64Local(String(wsPath), String(filename), String(base64Data)))
  ipcMain.handle('workspace:writeFile', async (_event, wsPath, relativePath, content) => {
    const targetPath = path.join(String(wsPath), String(relativePath))
    await ensureDir(path.dirname(targetPath))
    await fsp.writeFile(targetPath, String(content), 'utf-8')
    return { success: true, path: targetPath }
  })
  ipcMain.handle('workspace:saveManuscript', async (_event, wsPath, content, filename) => saveManuscriptLocal(String(wsPath), String(content), String(filename)))
  ipcMain.handle('workspace:saveExperimentPlan', async (_event, wsPath, content, filename) => saveManuscriptLocal(String(wsPath), String(content), String(filename)))

  ipcMain.handle('file:openDialog', async () => null)
  ipcMain.handle('file:openDirectoryDialog', async () => null)
  ipcMain.handle('file:saveDialog', async () => null)
  ipcMain.handle('file:openExternal', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:write', async (_event, filePathArg, content) => {
    await fsp.mkdir(path.dirname(String(filePathArg || '')), { recursive: true })
    await fsp.writeFile(String(filePathArg || ''), String(content || ''), 'utf-8')
    return { success: true, filePath: String(filePathArg || '') }
  })
  ipcMain.handle('file:writeDocx', async (_event, filePathArg) => ({ success: true, filePath: String(filePathArg || '') }))
  ipcMain.handle('file:read', async (_event, filePathArg) => ({ type: 'markdown', content: await fsp.readFile(String(filePathArg || ''), 'utf-8'), filePath: String(filePathArg || '') }))
  ipcMain.handle('file:listDirectoryImages', async () => [])
  ipcMain.handle('file:importImage', async () => null)
  ipcMain.handle('file:readImageAsDataUrl', async () => ({ filePath: fixtureImagePath, fileName: path.basename(fixtureImagePath), contentType: 'image/png', dataUrl: `data:image/png;base64,${await fsp.readFile(fixtureImagePath, 'base64')}` }))

  ipcMain.handle('compat:submitTask', async (_event, payload) => {
    const task = buildTaskState(String((payload || {}).topic || ''), typeof (payload || {}).workspacePath === 'string' ? String((payload || {}).workspacePath) : undefined)
    compatTasks.set(task.id, task)
    mainWindow?.webContents.send('ai:event', { scope: 'paper', taskId: task.id, type: 'start', step: 1, message: '开始整篇论文生成' })
    return { status: 'success', task_id: task.id }
  })
  ipcMain.handle('compat:getTaskStatus', async (_event, taskId) => {
    const task = compatTasks.get(String(taskId || ''))
    if (!task) return { status: 'error', error: 'task not found' }
    task.pollCount += 1
    if (task.pollCount < 2) {
      mainWindow?.webContents.send('ai:event', { scope: 'paper', taskId: task.id, type: 'progress', step: 1, message: '正在生成论文正文' })
      return {
        status: 'success',
        task: {
          task_id: task.id,
          topic: task.topic,
          status: 'running',
          current_step: 1,
          status_message: '正在生成论文正文',
          paper_markdown: task.markdown.split('\n').slice(0, 4).join('\n'),
        },
      }
    }
    mainWindow?.webContents.send('ai:event', { scope: 'paper', taskId: task.id, type: 'done', step: 2, message: '整篇论文生成完成' })
    return {
      status: 'success',
      task: {
        task_id: task.id,
        topic: task.topic,
        status: 'completed',
        current_step: 2,
        status_message: '整篇论文生成完成',
        paper_markdown: task.markdown,
      },
    }
  })
  ipcMain.handle('compat:getTaskResult', async (_event, taskId) => {
    const task = compatTasks.get(String(taskId || ''))
    if (!task) return { status: 'error', error: 'task not found' }
    return {
      status: 'success',
      result: {
        paper_title: task.title,
        paper_markdown: task.markdown,
        reference_list: task.references,
        images: [
          {
            path: task.imagePath,
            filename: 'figure-1.png',
            section: '图 1',
          },
        ],
      },
    }
  })
  ipcMain.handle('compat:getActiveTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:getRecentTasks', async () => ({ status: 'success', tasks: [] }))
  ipcMain.handle('compat:pauseTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:resumeTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:stopTask', async () => ({ status: 'success' }))
  ipcMain.handle('compat:findCitationForText', async () => ({ status: 'success', citations: [] }))
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

async function run(): Promise<void> {
  ensureFileExists(rendererPath, uiSmokeMode === 'packaged' ? 'packaged renderer bundle' : 'renderer build')
  ensureFileExists(preloadPath, uiSmokeMode === 'packaged' ? 'packaged preload bundle' : 'preload build')

  patchPackagedRuntime()
  tempUserDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-writer-article-ui-smoke-'))
  workspaceRootDir = path.join(tempUserDataDir, 'workspaces')
  fixtureImagePath = path.join(tempUserDataDir, 'fixtures', 'figure-source.png')
  await fsp.mkdir(path.dirname(fixtureImagePath), { recursive: true })
  await createFixtureImage(fixtureImagePath)
  app.setPath('userData', tempUserDataDir)
  app.commandLine.appendSwitch('disable-gpu')

  registerIpcHandlers()
  await createSmokeWindow()

  const initialState = await waitForCondition((state) => (
    state.bodyText.includes('选择产品入口')
    || (state.bodyText.includes('新建文章') && state.bodyText.includes('打开已有文章目录'))
  ), 'initial writer state', 15000)

  if (initialState.bodyText.includes('选择产品入口')) {
    await clickButton('进入 3.0 工作台')
  }
  await waitForCondition((state) => state.bodyText.includes('新建文章') && state.bodyText.includes('打开已有文章目录'), 'writer no-workspace entry', 15000)

  await executeInRenderer(`(() => {
    window.prompt = () => '首篇文章UI烟测'
  })()`)
  await clickButton('+ 新建文章')
  await waitForMainProcessCondition(() => createdWorkspacePaths.length >= 1, 'first workspace creation', 10000)
  await waitForText('首篇文章UI烟测.docx', 15000)
  await clickButtonByTitle('新建文档')
  await waitForMainProcessCondition(async () => await executeInRenderer(`document.querySelector('[contenteditable="true"]') !== null`), 'editor ready', 15000)
  await waitForText('未命名文档', 15000)

  const firstWorkspacePath = createdWorkspacePaths[0]
  await openContextMenuOnEditor()
  await waitForText('一键生成全文', 10000)
  await clickExactText('✨ 一键生成全文')
  await waitForCondition((state) => state.buttons.some((button) => button.text === '发送'), 'generation composer send button', 15000)
  await setComposerInput('多模态医学影像临床辅助诊断')
  await waitForCondition((state) => state.buttons.some((button) => button.text === '发送' && !button.disabled), 'generation composer send enabled', 15000)
  await clickButton('发送')
  await waitForCondition((state) => state.bodyText.includes('论文生成已完成') || state.bodyText.includes('全文内容已生成完成'), 'paper generation completed', 25000)

  await waitForMainProcessCondition(async () => {
    const rootEntries = await fsp.readdir(firstWorkspacePath, { withFileTypes: true })
    const visibleNames = rootEntries.filter((entry) => !entry.name.startsWith('.')).map((entry) => entry.name)
    const picDir = path.join(firstWorkspacePath, 'pic')
    const picFiles = await fsp.readdir(picDir).catch(() => [] as string[])
    return visibleNames.some((name) => name.endsWith('.docx'))
      && visibleNames.some((name) => name.endsWith('.references.json'))
      && visibleNames.some((name) => name.endsWith('.references.txt'))
      && visibleNames.includes('pic')
      && picFiles.some((name) => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(name))
  }, 'generated article artifacts written to workspace', 20000)

  await clickButtonByTitle('关闭工作区')
  await waitForCondition((state) => state.bodyText.includes('新建文章') && state.bodyText.includes('打开已有文章目录'), 'returned to no-workspace state', 15000)
  await executeInRenderer(`(() => {
    window.prompt = () => '第二篇文章UI烟测'
  })()`)
  await clickButton('+ 新建文章')
  await waitForMainProcessCondition(() => createdWorkspacePaths.length >= 2, 'second workspace creation', 10000)

  const secondWorkspacePath = createdWorkspacePaths[1]
  const firstWorkspaceEntries = (await fsp.readdir(firstWorkspacePath, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  const manuscriptFileName = firstWorkspaceEntries.find((name) => name.endsWith('.docx')) || ''
  const referencesJsonFileName = firstWorkspaceEntries.find((name) => name.endsWith('.references.json')) || ''
  const referencesTxtFileName = firstWorkspaceEntries.find((name) => name.endsWith('.references.txt')) || ''
  const picEntries = (await fsp.readdir(path.join(firstWorkspacePath, 'pic'))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  const expectedImagePath = picEntries.length > 0 ? path.join(firstWorkspacePath, 'pic', picEntries[0]) : ''
  const workspaceList = await listWorkspacesLocal()

  if (!manuscriptFileName || !referencesJsonFileName || !referencesTxtFileName || !firstWorkspaceEntries.includes('pic') || picEntries.length === 0) {
    throw new Error(`[smoke] first workspace missing expected artifacts: ${JSON.stringify(firstWorkspaceEntries)}`)
  }
  if (workspaceList.length < 2) {
    throw new Error(`[smoke] expected at least 2 workspaces after creating second article, got ${workspaceList.length}`)
  }

  console.log('[smoke] writer article ui flow ok')
  console.log(JSON.stringify({
    mode: uiSmokeMode,
    firstWorkspacePath,
    firstWorkspaceEntries,
    manuscriptPath: path.join(firstWorkspacePath, manuscriptFileName),
    referencesJsonPath: path.join(firstWorkspacePath, referencesJsonFileName),
    referencesTxtPath: path.join(firstWorkspacePath, referencesTxtFileName),
    imagePath: expectedImagePath,
    secondWorkspacePath,
    workspaceCount: workspaceList.length,
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