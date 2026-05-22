import './polyfills'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell, type OpenDialogOptions } from 'electron'
import fs from 'node:fs/promises'
import syncFs from 'node:fs'
import path from 'node:path'
import mammoth from 'mammoth'
import { SettingsStore } from './services/settingsStore'
import { testLlmConnection } from './services/llmClient'
import { testImageConnection, generateImage } from './services/imageClient'
import {
  analyzeTopic,
  continueWriting,
  generateExperimentPlan,
  generateOutline,
  generatePaper,
  runWritingAssistant,
  rewriteParagraph,
} from './services/paperGenerator'
import { exportDocxToPath, exportPdf, exportPdfFromEditorHtml } from './services/pdfExporter'
import { exportWithJournalFormat } from './services/journalDocxExporter'
import { LocalTaskService } from './services/localTaskService'
import { WorkspaceService } from './services/workspaceService'
import { type KnowledgeService, type CreateKnowledgeRemakeVersionInput, type KnowledgeDocumentCategory, type SaveKnowledgeTaskInput } from './services/knowledgeService'
import { DepartmentService, PRESET_DEPARTMENTS } from './services/departmentService'
import * as remoteKB from './services/remoteKnowledgeClient'
import { searchReferencesWithNftcoreStrategy } from './services/openAlexClient'
import { organizeReferences } from './services/referenceManager'
import { DocumentEngineService } from './services/documentEngineService'
import { PlotAgentService } from './services/plotAgentService'
import { getVoskModelInfo, registerVoskResourceProtocol } from './services/voskModelService'
import { FormalTemplateTaskService } from './services/formalTemplate/formalTemplateTaskService'
import { generatePptx, type PptxGenerateInput } from './services/pptxGenerator'
import {
  saveContentPackage,
  loadContentPackage,
  listContentPackages,
  renderWithSkill as renderPptxWithSkill,
  listPptSkills,
} from './services/pptContentPackageService'
import { listPptTemplates, loadSkillTemplates } from './services/pptTemplateRegistry'
import {
  saveDeckDocument,
  loadDeckDocument,
  renderDeckDocument,
  resolveDefaultSourceTemplatePath,
  updateDeckSlide,
  updateDeckDocument,
} from './services/deckDocumentService'
import { renderPptxPreview } from './services/ppt/pptxPreviewService'
import { optimizeDeckStructure } from './services/ppt/deckOptimizerService'
import { importPptxFromFile } from './services/ppt/pptxImportService'
import { saveEmailAttachmentToWorkspace } from './services/emailAttachmentOpenService'
import { buildPptSkillTemplatePath } from './services/pptTemplateRegistry'
import { initBusinessReportLight } from './services/ppt/templates/business_report_light'
import { initChineseSeasonLight } from './services/ppt/templates/chinese_season_light'
import { initAcademicDefense } from './services/ppt/templates/academic_defense'
import {
  buildDeckFromPromptService,
  buildDeckFromManuscriptService,
  buildDeckFromImportedPptxService,
  extractRawPptxSlides,
} from './services/ppt/deckBuilder/deckBuilderService'
import { DailyReportTaskService } from './services/dailyReportTaskService'
import { EssayTaskService } from './services/essayTaskService'
import { extractQuestionsFromPdfImages, extractQuestionsFromDocx, generateAnswer as homeworkGenerateAnswer, exportToMarkdown as homeworkExportToMarkdown } from './services/homeworkService'
import { isVoiceCaptureWebContentsId, registerVoiceProxyIpc } from './services/voiceProxyService'
import { PersonalLibraryService } from './services/personalLibraryService'
import { ensureSkillPlatformRunning, stopSkillPlatform, getSkillSyncPlan, listMySkins, downloadSkillPackage, getStoreEmbedUrl, buildStoreLoginUrl, recognizeSkillPackage, STORE_BASE, DEMO_ACCOUNT, DEMO_PASSWORD } from './services/skillPlatformService'
import { EmailService } from './services/emailService'
import type { EmailAccountConfig, FetchedMail, EmailAttachmentMeta } from './services/emailService'
import { classifyEmailError } from './services/emailService'
import { CredentialService } from './services/credentialService'
import { SCHOOL_CUHK_EXCHANGE_CONFIG } from './services/mail/schoolExchangeConfig'
import * as workspaceActivity from './services/workspaceActivityService'
import { WorkspaceActivitySyncService } from './services/workspaceActivitySyncService'
import { userActionLogService, createPathHash, inferFileType } from './services/userActionLogService'
import { delegationService } from './services/delegationService'
import {
  runExcelAnalysis,
  setExcelAnalysisLogSink,
  checkExcelEnvStatus,
  rebuildExcelEnv,
  runExcelPythonDiagnostics,
} from './services/excelAnalysisService'
import { listBundledPlotDataModels } from './services/plotDataModelService'
import { IntroductionRemakeService } from '../../../introduction-remake-app/electron/main/services/introductionRemake/introductionRemakeService'
import { testLocalLlmConnection } from '../../../introduction-remake-app/electron/main/services/introductionRemake/llmClient'
import type { LiteraturePoolItem } from '../../../introduction-remake-app/electron/main/services/introductionRemake/types'
import { exportIntroductionRemakeBundle, readIntroductionRecentTasks, saveIntroductionTaskSnapshot } from '../../../introduction-remake-app/electron/main/services/introductionRemake/taskArtifacts'

let mainWindow: BrowserWindow | null = null
let introductionRemakeWindow: BrowserWindow | null = null
let allowMainWindowClose = false
const activeIntroductionDraftStreams = new Map<string, { cancel: () => void }>()
const pptTaskControllers = new Map<string, AbortController>()

// Safety net: prevent email/network socket errors from crashing the main process.
// ImapFlow and nodemailer emit EventEmitter 'error' events that can escape their
// Promise chains (e.g., socket timeout on an idle connection). Without this handler
// Node.js would throw them as uncaught exceptions and crash Electron.
process.on('uncaughtException', (err) => {
  const msg = err?.message ?? ''
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const isNetworkError = (
    /Socket timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(msg) ||
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND/.test(code)
  )
  if (isNetworkError) {
    console.error('[Main] Suppressed network socket error (email/IMAP/SMTP):', msg || code)
    return
  }
  // Re-throw truly unexpected errors so they don't get silently swallowed
  throw err
})

interface MaterializeKnowledgeWorkspaceInput {
  workspaceName?: string
  fileName?: string
  documentId?: string
  versionId?: string
  sourceDocumentIds?: string[]
  content?: string
}

interface SaveManuscriptOptions {
  templateDocumentId?: string
}

async function resolveWindowIconPath(): Promise<string | undefined> {
  const candidates = [
    path.join(app.getAppPath(), 'public', 'app-icon.png'),
    path.join(app.getAppPath(), 'dist', 'app-icon.png'),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      continue
    }
  }

  return undefined
}

function resolveBundledKnowledgeSeedPaths(): string[] {
  const knowledgeSeedRoot = app.isPackaged
    ? path.join(process.resourcesPath || '', 'data', 'knowledge-seeds')
    : path.join(app.getAppPath(), 'electron', 'main', 'data', 'knowledge-seeds')
  const essayStylePresetRoot = app.isPackaged
    ? path.join(process.resourcesPath || '', 'data', 'essay-style-presets')
    : path.join(app.getAppPath(), 'docs', 'photoes')
  const bundledImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

  const collectFiles = (baseDir: string, recursive = false, allowedExtensions?: Set<string>): string[] => {
    try {
      return syncFs.readdirSync(baseDir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name.startsWith('.')) return []
        const entryPath = path.join(baseDir, entry.name)
        if (entry.isDirectory()) {
          return recursive ? collectFiles(entryPath, true, allowedExtensions) : []
        }
        if (!entry.isFile()) return []
        if (allowedExtensions && !allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
          return []
        }
        return [entryPath]
      })
    } catch {
      return []
    }
  }

  return [
    ...collectFiles(knowledgeSeedRoot),
    ...collectFiles(essayStylePresetRoot, true, bundledImageExtensions),
  ].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

function resolveBundledReadingSeedPaths(departmentNameEn: string): string[] {
  const readingSeedRoot = app.isPackaged
    ? path.join(process.resourcesPath || '', 'data', 'reading-seeds')
    : path.join(app.getAppPath(), 'electron', 'main', 'data', 'reading-seeds')
  const deptSeedDir =
    departmentNameEn === 'classic-reading'
      ? path.join(readingSeedRoot, 'classic')
      : departmentNameEn === 'scientific-papers'
        ? path.join(readingSeedRoot, 'scientific')
        : ''

  if (!deptSeedDir) return []

  try {
    return syncFs
      .readdirSync(deptSeedDir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && entry.isFile())
      .map((entry) => path.join(deptSeedDir, entry.name))
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  } catch {
    return []
  }
}

function sanitizeStorageDirName(rawName: string, fallback = 'app'): string {
  const normalized = String(rawName || '')
    .replace(/\.app$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function resolvePackagedAppContainerDir(): string {
  if (process.platform === 'darwin') {
    return path.dirname(path.dirname(path.dirname(process.execPath)))
  }
  return path.dirname(process.execPath)
}

function resolveSiblingWorkspaceBaseDir(): string | null {
  if (!app.isPackaged) {
    return null
  }

  const appContainerDir = resolvePackagedAppContainerDir()
  const parentDir = path.dirname(appContainerDir)
  const siblingName = `${sanitizeStorageDirName(path.basename(appContainerDir), sanitizeStorageDirName(app.getName(), 'app'))}-workspaces`
  return path.join(parentDir, siblingName)
}

async function resolveWorkspaceStoragePaths(): Promise<{
  baseDir: string
  legacyBaseDirs: string[]
  strategy: 'install-sibling' | 'user-data'
}> {
  const legacyBaseDir = path.join(app.getPath('userData'), 'workspaces')
  const preferredBaseDir = resolveSiblingWorkspaceBaseDir()
  const uniqueCandidates = Array.from(new Set([
    preferredBaseDir,
    legacyBaseDir,
  ].filter((value): value is string => Boolean(value))))

  for (const candidate of uniqueCandidates) {
    try {
      await fs.mkdir(candidate, { recursive: true })
      return {
        baseDir: candidate,
        legacyBaseDirs: candidate === legacyBaseDir ? [] : [legacyBaseDir],
        strategy: candidate === legacyBaseDir ? 'user-data' : 'install-sibling',
      }
    } catch {
      continue
    }
  }

  throw new Error('无法初始化工作区根目录')
}

function isTrustedRendererOrigin(originOrUrl: string): boolean {
  const normalized = String(originOrUrl || '').trim()
  if (!normalized) return false
  if (normalized.startsWith('file://')) return true

  const devServerUrl = String(process.env.VITE_DEV_SERVER_URL || '').trim()
  if (!devServerUrl) return false

  try {
    return new URL(normalized).origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

function resolvePermissionOrigin(details: Record<string, unknown>, fallbackUrl?: string): string {
  const candidates = [
    String(details.requestingUrl || ''),
    String(details.securityOrigin || ''),
    String(fallbackUrl || ''),
  ]

  return candidates.find((value) => String(value || '').trim()) || ''
}

function shouldGrantMediaPermission(details: Record<string, unknown>): boolean {
  const mediaType = String(details.mediaType || '').trim().toLowerCase()
  return !mediaType || mediaType === 'audio' || mediaType === 'unknown'
}

function shouldGrantRendererPermission(
  permission: string,
  originOrUrl: string,
  details: Record<string, unknown>,
): boolean {
  const normalizedPermission = String(permission || '').trim()
  if (!isTrustedRendererOrigin(originOrUrl)) return false

  if (normalizedPermission === 'media') {
    return shouldGrantMediaPermission(details)
  }

  return normalizedPermission === 'clipboard-sanitized-write' || normalizedPermission === 'fullscreen'
}

function configureRendererPermissionHandlers(): void {
  const defaultSession = session.defaultSession

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const record = (details || {}) as unknown as Record<string, unknown>
    if (permission === 'media' && isVoiceCaptureWebContentsId(webContents?.id)) {
      return shouldGrantMediaPermission(record)
    }
    const resolvedOrigin = resolvePermissionOrigin(record, requestingOrigin || webContents?.getURL())
    return shouldGrantRendererPermission(permission, resolvedOrigin, record)
  })

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const record = (details || {}) as unknown as Record<string, unknown>
    if (permission === 'media' && isVoiceCaptureWebContentsId(webContents.id)) {
      callback(shouldGrantMediaPermission(record))
      return
    }
    const resolvedOrigin = resolvePermissionOrigin(record, webContents.getURL())
    callback(shouldGrantRendererPermission(permission, resolvedOrigin, record))
  })
}

function normalizeKnowledgeDocumentCategory(value: unknown): KnowledgeDocumentCategory {
  const normalized = String(value || '').trim().toLowerCase()
  const validCategories: KnowledgeDocumentCategory[] = [
    'notice', 'report', 'briefing', 'proposal', 'minutes',
    'contract', 'letter', 'regulation', 'plan', 'summary',
    'manual', 'academic', 'other',
  ]
  return validCategories.includes(normalized as KnowledgeDocumentCategory)
    ? (normalized as KnowledgeDocumentCategory)
    : 'other'
}

function getImageContentType(filePath: string): string {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.bmp') return 'image/bmp'
  return 'application/octet-stream'
}

function isSupportedImageFile(filePath: string): boolean {
  return /^image\//.test(getImageContentType(filePath))
}

function safelySendToWindow(win: import('electron').BrowserWindow | null | undefined, channel: string, ...args: unknown[]): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  // Pre-check mainFrame to avoid Electron printing its own "Error sending from
  // webFrameMain" stderr message before throwing (happens when the render frame
  // is disposed mid-navigation / HMR reload but webContents is still alive).
  try {
    // Accessing mainFrame throws synchronously if the frame is already disposed.
    void win.webContents.mainFrame
  } catch {
    return
  }
  try {
    win.webContents.send(channel, ...args)
  } catch {
    // Race condition: frame was disposed between the mainFrame check and send
  }
}

function emitAiEvent(payload: Record<string, unknown>): void {
  safelySendToWindow(mainWindow, 'ai:event', payload)
}

function sanitizeWorkspaceSeed(rawValue: string, fallback: string): string {
  const normalized = String(rawValue || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return normalized || fallback
}

function sanitizeDocxName(rawValue: string, fallback: string): string {
  const seed = String(rawValue || '').replace(/\.docx$/i, '')
  const normalized = seed
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${normalized || fallback}.docx`
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function normalizeFileSystemReadPath(sourcePath: string): string {
  const source = String(sourcePath || '').trim()
  if (!source) return source
  if (source.startsWith('file://')) {
    try {
      const url = new URL(source)
      const pathname = decodeURI(url.pathname || '')
      if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) return pathname.slice(1)
      return pathname || source.replace(/^file:\/\//, '')
    } catch {
      const stripped = decodeURI(source.replace(/^file:\/\//, ''))
      return /^\/[a-zA-Z]:[\\/]/.test(stripped) ? stripped.slice(1) : stripped
    }
  }
  if (/^\/[a-zA-Z]:[\\/]/.test(source)) return source.slice(1)
  return source
}

async function ensureUniqueFilePath(targetPath: string): Promise<string> {
  if (!(await pathExists(targetPath))) return targetPath

  const directory = path.dirname(targetPath)
  const extension = path.extname(targetPath)
  const baseName = path.basename(targetPath, extension)
  let index = 1
  while (true) {
    const candidate = path.join(directory, `${baseName}-${index}${extension}`)
    if (!(await pathExists(candidate))) return candidate
    index += 1
  }
}

async function resolveKnowledgeWordTemplatePath(
  knowledgeService: KnowledgeService,
  documentId?: string,
): Promise<string | undefined> {
  const normalizedDocumentId = String(documentId || '').trim()
  if (!normalizedDocumentId) return undefined

  const detail = await knowledgeService.getDocument(normalizedDocumentId)
  if (!detail || !['doc', 'docx'].includes(detail.meta.sourceType)) return undefined

  const knowledgeInfo = await knowledgeService.getInfo()
  const storedPath = path.join(knowledgeInfo.rootPath, detail.meta.storedRelativePath)
  return (await pathExists(storedPath)) ? storedPath : undefined
}

async function materializeKnowledgeWorkspace(
  workspaceService: WorkspaceService,
  knowledgeService: KnowledgeService,
  payload: MaterializeKnowledgeWorkspaceInput,
) {
  const documentId = String(payload.documentId || '').trim()
  const versionId = String(payload.versionId || '').trim()
  const explicitContent = String(payload.content || '').trim()
  const explicitWorkspaceName = String(payload.workspaceName || '').trim()
  const explicitFileName = String(payload.fileName || '').trim()
  const requestedSourceIds = Array.isArray(payload.sourceDocumentIds)
    ? payload.sourceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const primaryDetail = documentId ? await knowledgeService.getDocument(documentId) : null
  if (documentId && !primaryDetail) {
    throw new Error('未找到对应的知识库文档')
  }

  let baseContent = explicitContent
  if (!baseContent && primaryDetail) {
    if (versionId) {
      const versionDetail = await knowledgeService.getDocumentVersion(primaryDetail.meta.id, versionId)
      baseContent = String(versionDetail?.text || '').trim()
    }
    if (!baseContent) {
      baseContent = String(primaryDetail.extractedText || primaryDetail.originalExtractedText || '').trim()
    }
  }

  const fallbackTitle = primaryDetail?.meta.title || explicitFileName || '知识库文章'
  const workspaceSeed = sanitizeWorkspaceSeed(explicitWorkspaceName || fallbackTitle, '知识库文章')
  // Always create as .aidoc.json — lossless internal format
  const aidocBaseName = String(explicitFileName || fallbackTitle)
    .replace(/\.docx$/i, '')
    .replace(/\.aidoc\.json$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '知识库文章'
  const documentFileName = `${aidocBaseName}.aidoc.json`
  const workspaceResult = await workspaceService.createWorkspace(workspaceSeed)
  const workspacePath = workspaceResult.path
  const documentPath = path.join(workspacePath, 'documents', documentFileName)
  const sourceDir = path.join(workspacePath, 'source')
  await fs.mkdir(sourceDir, { recursive: true })

  const effectiveSourceIds = Array.from(new Set([documentId, ...requestedSourceIds].filter(Boolean)))
  const knowledgeInfo = await knowledgeService.getInfo()
  const manifestItems: Array<Record<string, unknown>> = []

  for (const sourceId of effectiveSourceIds) {
    const detail = sourceId === documentId && primaryDetail ? primaryDetail : await knowledgeService.getDocument(sourceId)
    if (!detail) continue
    const storedPath = path.join(knowledgeInfo.rootPath, detail.meta.storedRelativePath)
    if (!(await pathExists(storedPath))) continue
    const extension = path.extname(detail.meta.originalName || storedPath) || path.extname(storedPath)
    const sourceName = sanitizeWorkspaceSeed(detail.meta.title || detail.meta.originalName || sourceId, 'source')
    const copiedPath = await ensureUniqueFilePath(path.join(sourceDir, `${sourceName}${extension}`))
    await fs.copyFile(storedPath, copiedPath)
    manifestItems.push({
      documentId: detail.meta.id,
      title: detail.meta.title,
      originalName: detail.meta.originalName,
      sourceType: detail.meta.sourceType,
      copiedRelativePath: path.relative(workspacePath, copiedPath).replace(/\\/g, '/'),
      latestVersionId: detail.meta.latestVersionId || null,
      versionCount: detail.meta.versionCount,
    })
  }

  if (manifestItems.length > 0) {
    await fs.writeFile(path.join(sourceDir, 'knowledge-manifest.json'), JSON.stringify({
      createdAt: new Date().toISOString(),
      workspaceName: workspaceResult.name,
      sourceDocuments: manifestItems,
    }, null, 2), 'utf-8')
  }

  // Write as lossless .aidoc.json — no OOXML round-trip
  const effectiveDocPath = path.join(workspacePath, 'documents', documentFileName)
  await fs.mkdir(path.dirname(effectiveDocPath), { recursive: true })
  const aidocContent = JSON.stringify({
    version: 1,
    format: 'aidoc',
    paperTemplateId: null,
    tiptapJson: null,
    html: baseContent || '<p></p>',
  })
  await fs.writeFile(effectiveDocPath, aidocContent, 'utf-8')

  return {
    success: true,
    workspacePath,
    name: workspaceResult.name,
    documentPath,
    fileName: path.basename(documentPath),
    sourceCount: manifestItems.length,
  }
}

function resolveIntroductionRemakeRendererIndex(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'introduction-remake-app', 'dist', 'index.html'),
    path.join(process.cwd(), 'introduction-remake-app', 'dist', 'index.html'),
    path.resolve(app.getAppPath(), '../introduction-remake-app/dist/index.html'),
    path.resolve(__dirname, '../../../../introduction-remake-app/dist/index.html'),
  ]

  for (const candidate of candidates) {
    if (candidate && syncFs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

async function loadIntroductionRemakeWindow(browserWindow: BrowserWindow): Promise<void> {
  const introIndex = resolveIntroductionRemakeRendererIndex()
  if (introIndex) {
    await browserWindow.loadFile(introIndex)
    return
  }

  await browserWindow.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Introduction Remake</title></head><body style="margin:0;padding:40px;background:#17130f;color:#f5efe5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><h1 style="margin:0 0 12px">Introduction Remake 资源未就绪</h1><p style="margin:0;color:#d6cfc2;line-height:1.7">当前安装包没有找到 bundled renderer。请重新执行 AI-Office 3.0 打包，确保 introduction-remake-app/dist 已被一起带入。</p></body></html>`)}`,
  )
}

async function openOrFocusIntroductionRemakeWindow(): Promise<BrowserWindow> {
  if (introductionRemakeWindow && !introductionRemakeWindow.isDestroyed()) {
    if (introductionRemakeWindow.isMinimized()) {
      introductionRemakeWindow.restore()
    }
    introductionRemakeWindow.focus()
    return introductionRemakeWindow
  }

  const icon = await resolveWindowIconPath()
  introductionRemakeWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    title: 'AI-Office Introduction Remake',
    icon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  })

  introductionRemakeWindow.on('closed', () => {
    introductionRemakeWindow = null
  })

  await loadIntroductionRemakeWindow(introductionRemakeWindow)
  introductionRemakeWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  return introductionRemakeWindow
}

function mapEffectiveSettingsToIntroductionConfig(settings: Awaited<ReturnType<SettingsStore['resolveEffectiveSettings']>>): Record<string, unknown> {
  return {
    provider: settings.llm.provider,
    apiKey: settings.llm.apiKey,
    model: settings.llm.model,
    customEndpoint: settings.llm.baseUrl,
  }
}

function mapPayloadToIntroductionConfig(
  payload: Record<string, unknown>,
  settings: Awaited<ReturnType<SettingsStore['resolveEffectiveSettings']>>,
): Record<string, unknown> {
  const effective = mapEffectiveSettingsToIntroductionConfig(settings)
  const provider = String(payload.provider || effective.provider || 'qwen').trim()
  const apiKey = String(payload.apiKey || '').trim()
  const model = String(payload.model || '').trim()
  const customEndpoint = String(payload.customEndpoint || '').trim()

  return {
    provider,
    apiKey: apiKey || String(effective.apiKey || ''),
    model: model || String(effective.model || ''),
    customEndpoint: customEndpoint || String(effective.customEndpoint || ''),
  }
}

async function createWindow(): Promise<void> {
  const icon = await resolveWindowIconPath()
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: 'AI-Office 3.0',
    icon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      webSecurity: false,
    },
  })

  const url = process.env.VITE_DEV_SERVER_URL
  if (url) {
    await mainWindow.loadURL(url)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const rendererPath = path.join(app.getAppPath(), 'dist/index.html')
    await mainWindow.loadFile(rendererPath)
  }

  mainWindow.on('close', (event) => {
    if (allowMainWindowClose) {
      allowMainWindowClose = false
      return
    }
    event.preventDefault()
    safelySendToWindow(mainWindow, 'app:requestClose')
  })

  // Recover from renderer process crashes (e.g. WASM OOM / trap from vosk-browser).
  // Without this handler the window just shows a white screen permanently.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[RenderProcessGone]', JSON.stringify(details))
    // Don't attempt to reload on a normal clean exit.
    if (details.reason === 'clean-exit') return
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    // Give Chromium a moment to clean up before reloading.
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      const reloadUrl = process.env.VITE_DEV_SERVER_URL
      if (reloadUrl) {
        win.loadURL(reloadUrl).catch(() => undefined)
      } else {
        win.loadFile(path.join(app.getAppPath(), 'dist/index.html')).catch(() => undefined)
      }
    }, 800)
  })
}

// Trust the self-signed certificate of the local voice recognition service by its SPKI fingerprint.
// This is scoped only to this one certificate and does not affect any other SSL connections.
app.commandLine.appendSwitch(
  'ignore-certificate-errors-spki-list',
  'xEJYYg2NF569cIF8Rb2pO5V7UvgwYlqrgfV6icCPj24=',
)
// On some Windows audio drivers, Chromium's out-of-process audio service can
// crash the renderer when getUserMedia starts. Keep capture in-process.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')

// Track the last workspace path used so we can auto-snapshot on quit
let _lastActiveWorkspacePath: string | null = null
let _quitSnapshotDone = false

// Prevent multiple instances only in production.
// In dev mode, Vite HMR restarts the Electron process frequently; the lock
// would cause the restarted process to quit immediately.
if (!process.env.VITE_DEV_SERVER_URL) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  if (!gotSingleInstanceLock) {
    app.quit()
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  userActionLogService.startSession()
  await registerVoskResourceProtocol()
  configureRendererPermissionHandlers()
  registerVoiceProxyIpc()
  const store = new SettingsStore(app.getPath('userData'))
  const activitySync = new WorkspaceActivitySyncService(app.getPath('userData'))
  const introductionRemakeService = new IntroductionRemakeService()
  const imageOutputDir = path.join(app.getPath('userData'), 'generated-images')
  const workspaceStoragePaths = await resolveWorkspaceStoragePaths()
  const workspaceService = new WorkspaceService(workspaceStoragePaths.baseDir, {
    legacyBaseDirs: workspaceStoragePaths.legacyBaseDirs,
  })
  const knowledgeRootPath = path.join(app.getPath('userData'), 'knowledge-base')
  const knowledgeServiceOptions = {
    bundledSeeds: {
      enabled: true,
      version: 'knowledge-defaults-20260415-school-office-v5',
      filePaths: resolveBundledKnowledgeSeedPaths(),
    },
  }
  const departmentService = new DepartmentService(knowledgeRootPath, knowledgeServiceOptions)
  const localTaskService = new LocalTaskService(workspaceService, emitAiEvent)
  const dailyReportTaskService = new DailyReportTaskService(emitAiEvent)
  const essayTaskService = new EssayTaskService(emitAiEvent)
  const documentEngineService = new DocumentEngineService()
  const plotAgentService = new PlotAgentService()
  await departmentService.initialize()

  const personalLibraryRootPath = path.join(app.getPath('userData'), 'personal-library')
  const personalLibraryService = new PersonalLibraryService(personalLibraryRootPath)
  await personalLibraryService.initialize()

  const getEffectiveSettings = async () => store.resolveEffectiveSettings()
  departmentService.setSettingsGetter(getEffectiveSettings)
  departmentService.setEmitAiEvent(emitAiEvent)

  // Helper to resolve department bundle from IPC calls
  const resolveDeptBundle = async (departmentId?: unknown) => {
    const deptId = typeof departmentId === 'string' && departmentId.trim()
      ? departmentId.trim()
      : departmentService.getDefaultDepartmentId()
    return departmentService.getBundle(deptId)
  }

  const resolveRemoteKnowledgePartitionId = (departmentId?: unknown) => {
    const deptId = typeof departmentId === 'string' && departmentId.trim()
      ? departmentId.trim()
      : departmentService.getDefaultDepartmentId()
    const department = departmentService.getDepartment(deptId)
    if (department && (department.nameEn === 'classic-reading' || department.nameEn === 'scientific-papers')) {
      return department.nameEn
    }
    return deptId
  }

  // Backward-compat: get the default department's knowledge service for legacy callers
  const getDefaultKnowledgeService = async () => (await resolveDeptBundle()).knowledgeService
  const getDefaultRetrievalService = async () => (await resolveDeptBundle()).retrievalService
  const getDefaultTaskService = async () => (await resolveDeptBundle()).taskService

  // ---- 正式模板模式服务实例 ----
  const formalTemplateService = new FormalTemplateTaskService({
    readOoxmlPackage: (fp) => documentEngineService.readOoxmlPackage(fp),
    writeOoxmlPackage: (fp, p) => documentEngineService.writeOoxmlPackage(fp, p),
    getDocumentSourcePath: async (id) => {
      const knowledgeService = await getDefaultKnowledgeService()
      const detail = await knowledgeService.getDocument(id)
      return detail ? path.join(knowledgeRootPath, detail.meta.storedRelativePath) : null
    },
    getDocumentMeta: async (id) => {
      const knowledgeService = await getDefaultKnowledgeService()
      const detail = await knowledgeService.getDocument(id)
      return detail ? { title: detail.meta.title, sourceType: detail.meta.sourceType, documentCategory: detail.meta.documentCategory } : null
    },
    retrieveChunks: async (q) => {
      const retrievalService = await getDefaultRetrievalService()
      return retrievalService.retrieveChunks({
        query: q.query,
        mode: 'auto',
        requiredReferenceDocumentIds: q.referenceDocumentIds || [],
        maxChunks: q.maxChunks || 8,
      })
    },
    getSettings: () => store.resolveEffectiveSettings(),
  })

  const resolveWorkspaceImageOutputDir = async (workspacePath?: unknown): Promise<string> => {
    const normalizedWorkspacePath = String(workspacePath || '').trim()
    if (!normalizedWorkspacePath) {
      return imageOutputDir
    }

    try {
      await workspaceService.detectProjectStructure(normalizedWorkspacePath)
      return path.join(normalizedWorkspacePath, 'pic')
    } catch {
      return imageOutputDir
    }
  }

  ipcMain.handle('app:getInfo', async () => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
    workspaceBaseDir: workspaceStoragePaths.baseDir,
    workspaceBaseDirStrategy: workspaceStoragePaths.strategy,
    vosk: await getVoskModelInfo(),
  }))
  ipcMain.on('app:getVoskTestMode', (event) => {
    event.returnValue = ''
  })
  ipcMain.handle('app:resolveCloseRequest', async (event, resolution) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { success: false, canceled: true }
    }

    if (String(resolution) !== 'close') {
      return { success: true, canceled: true }
    }

    if (senderWindow === mainWindow) {
      allowMainWindowClose = true
    }
    senderWindow.close()
    return { success: true, canceled: false }
  })
  ipcMain.handle('settings:get', () => store.getPublicSettings())
  ipcMain.handle('settings:save', (_, payload) => store.save(payload))
  ipcMain.handle('settings:testLlm', async () => testLlmConnection(await getEffectiveSettings()))
  ipcMain.handle('settings:testImage', async () => testImageConnection(await getEffectiveSettings()))
  ipcMain.handle('suite:launchCompanion', async (_event, appId) => {
    if (String(appId) !== 'introduction-remake') {
      throw new Error('未知套件应用')
    }

    await openOrFocusIntroductionRemakeWindow()
    return {
      success: true,
      mode: 'launched' as const,
      message: '已打开 Introduction Remake 内置模块。',
    }
  })
  ipcMain.handle('suite:returnToLauncher', async (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      safelySendToWindow(mainWindow, 'suite:navigate', { view: 'suite' })
      mainWindow.focus()
    }

    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && senderWindow !== mainWindow && !senderWindow.isDestroyed()) {
      senderWindow.close()
    }

    return {
      success: true,
      message: '已返回套件启动器。',
    }
  })
  ipcMain.handle('introRemake:getServiceInfo', async () => introductionRemakeService.getServiceInfo())
  ipcMain.handle('introRemake:getAllowedJournals', async () => introductionRemakeService.getAllowedJournalsMetadata())
  ipcMain.handle('introRemake:listRecentTasks', async () => readIntroductionRecentTasks(app.getPath('userData')))
  ipcMain.handle('introRemake:saveTaskSnapshot', async (_event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    return saveIntroductionTaskSnapshot(app.getPath('userData'), {
      taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
      topic: String(record.topic || ''),
      sourceIntroduction: String(record.sourceIntroduction || ''),
      pool: Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
      result: (record.result || {}) as any,
      status: (record.status as 'draft' | 'delivered' | 'exported') || 'delivered',
      exportDir: typeof record.exportDir === 'string' ? record.exportDir : undefined,
    })
  })
  ipcMain.handle('introRemake:exportBundle', async (event, payload) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) || introductionRemakeWindow || mainWindow || undefined
    const chosen = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        })
    if (chosen.canceled || !chosen.filePaths[0]) {
      return { success: false, canceled: true }
    }

    const record = (payload || {}) as Record<string, unknown>
    const result = await exportIntroductionRemakeBundle(app.getPath('userData'), {
      baseDirectory: chosen.filePaths[0],
      taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
      topic: String(record.topic || ''),
      topicMeta: (record.topicMeta || null) as any,
      sourceIntroduction: String(record.sourceIntroduction || ''),
      rewrittenDraft: String(record.rewrittenDraft || ''),
      auditText: String(record.auditText || ''),
      pool: Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
      poolMeta: (record.poolMeta || null) as any,
      result: (record.result || {}) as any,
    })

    return { success: true, canceled: false, ...result }
  })
  ipcMain.handle('introRemake:testLlmSettings', async (_event, payload) => testLocalLlmConnection(
    mapPayloadToIntroductionConfig((payload || {}) as Record<string, unknown>, await getEffectiveSettings()),
  ))
  ipcMain.handle('introRemake:inferTopicMeta', async (_event, introductionText) => introductionRemakeService.inferTopicMeta(String(introductionText || '')))
  ipcMain.handle('introRemake:buildAllowlistedPool', async (_event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    return introductionRemakeService.buildAllowlistedPool({
      topic: String(record.topic || ''),
      minPublicationYear: Math.max(1990, Math.min(2035, Number(record.minPublicationYear) || 2015)),
      maxPapersForLlm: Math.max(1, Math.min(200, Number(record.maxPapersForLlm) || 100)),
      secondPassTopic: typeof record.secondPassTopic === 'string' ? record.secondPassTopic : undefined,
    })
  })
  ipcMain.handle('introRemake:generateDraft', async (_event, payload) => {
    const record = (payload || {}) as Record<string, unknown>
    return introductionRemakeService.generateDraft({
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

    const streamHandle = introductionRemakeService.generateDraftStream({
      originalIntroduction: String(record.originalIntroduction || ''),
      pool: Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
      context: typeof record.context === 'string' ? record.context : undefined,
      onDelta: ({ delta, accumulated }) => {
        safelySendToWindow(browserWindow, 'introRemake:generateDraftStreamEvent', {
          streamId,
          type: 'delta',
          delta,
          accumulated,
        })
      },
      onComplete: (result) => {
        activeIntroductionDraftStreams.delete(streamId)
        safelySendToWindow(browserWindow, 'introRemake:generateDraftStreamEvent', {
          streamId,
          type: 'complete',
          result,
        })
      },
      onError: (errorMessage) => {
        activeIntroductionDraftStreams.delete(streamId)
        safelySendToWindow(browserWindow, 'introRemake:generateDraftStreamEvent', {
          streamId,
          type: 'error',
          error: errorMessage,
        })
      },
    })

    activeIntroductionDraftStreams.set(streamId, streamHandle)
    safelySendToWindow(browserWindow, 'introRemake:generateDraftStreamEvent', {
      streamId,
      type: 'start',
    })
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
    return introductionRemakeService.remapDraft(
      String(record.remadeIntroduction || ''),
      Array.isArray(record.pool) ? (record.pool as LiteraturePoolItem[]) : [],
    )
  })
  ipcMain.handle('plot:status', async () => plotAgentService.getStatus())
  ipcMain.handle('plot:types', async () => plotAgentService.getChartTypes())
  ipcMain.handle('plot:recommend', async (_, payload) => {
    const filePath = String((payload as Record<string, unknown>)?.filePath || '').trim()
    if (!filePath) throw new Error('CSV 文件路径不能为空')
    return plotAgentService.recommendFromFile(filePath, Boolean((payload as Record<string, unknown>)?.useLlm))
  })
  ipcMain.handle('plot:generate', async (_, payload) => {
    const filePath = String((payload as Record<string, unknown>)?.filePath || '').trim()
    if (!filePath) throw new Error('CSV 文件路径不能为空')
    return plotAgentService.generateFromFile({
      filePath,
      chartType: typeof (payload as Record<string, unknown>)?.chartType === 'string' ? String((payload as Record<string, unknown>).chartType) : undefined,
      outputFormat: typeof (payload as Record<string, unknown>)?.outputFormat === 'string' ? ((payload as Record<string, unknown>).outputFormat as 'base64' | 'file') : undefined,
      style: typeof (payload as Record<string, unknown>)?.style === 'string' ? ((payload as Record<string, unknown>).style as 'publication' | 'default' | 'colorful') : undefined,
      title: typeof (payload as Record<string, unknown>)?.title === 'string' ? String((payload as Record<string, unknown>).title) : undefined,
      xlabel: typeof (payload as Record<string, unknown>)?.xlabel === 'string' ? String((payload as Record<string, unknown>).xlabel) : undefined,
      ylabel: typeof (payload as Record<string, unknown>)?.ylabel === 'string' ? String((payload as Record<string, unknown>).ylabel) : undefined,
      x: typeof (payload as Record<string, unknown>)?.x === 'string' ? String((payload as Record<string, unknown>).x) : undefined,
      y: typeof (payload as Record<string, unknown>)?.y === 'string' ? String((payload as Record<string, unknown>).y) : undefined,
      hue: typeof (payload as Record<string, unknown>)?.hue === 'string' ? String((payload as Record<string, unknown>).hue) : undefined,
      autoRecommend: (payload as Record<string, unknown>)?.autoRecommend === undefined ? undefined : Boolean((payload as Record<string, unknown>).autoRecommend),
      mode: typeof (payload as Record<string, unknown>)?.mode === 'string' ? ((payload as Record<string, unknown>).mode as 'smart' | 'manual') : undefined,
    })
  })
  ipcMain.handle('plot:realtimeCreateSession', async (_, payload) => plotAgentService.createRealtimeSession({
    chartType: String((payload as Record<string, unknown>)?.chartType || '').trim(),
    style: typeof (payload as Record<string, unknown>)?.style === 'string' ? ((payload as Record<string, unknown>).style as 'publication' | 'default' | 'colorful') : undefined,
    title: typeof (payload as Record<string, unknown>)?.title === 'string' ? String((payload as Record<string, unknown>).title) : undefined,
    xlabel: typeof (payload as Record<string, unknown>)?.xlabel === 'string' ? String((payload as Record<string, unknown>).xlabel) : undefined,
    ylabel: typeof (payload as Record<string, unknown>)?.ylabel === 'string' ? String((payload as Record<string, unknown>).ylabel) : undefined,
  }))
  ipcMain.handle('plot:realtimeAddPoint', async (_, payload) => {
    const sessionId = String((payload as Record<string, unknown>)?.sessionId || '').trim()
    if (!sessionId) throw new Error('实时绘图 sessionId 不能为空')
    const point = ((payload as Record<string, unknown>)?.point || {}) as Record<string, unknown>
    return plotAgentService.addRealtimePoint(sessionId, point)
  })
  ipcMain.handle('plot:realtimeAddBatch', async (_, payload) => {
    const sessionId = String((payload as Record<string, unknown>)?.sessionId || '').trim()
    if (!sessionId) throw new Error('实时绘图 sessionId 不能为空')
    const points = Array.isArray((payload as Record<string, unknown>)?.points)
      ? ((payload as Record<string, unknown>).points as Array<Record<string, unknown>>)
      : []
    return plotAgentService.addRealtimePoints(sessionId, points)
  })
  ipcMain.handle('plot:realtimeGetPlot', async (_, sessionId) => plotAgentService.getRealtimePlot(String(sessionId || '').trim()))
  ipcMain.handle('plot:realtimeGetStatus', async (_, sessionId) => plotAgentService.getRealtimeSessionStatus(String(sessionId || '').trim()))
  ipcMain.handle('plot:realtimeDeleteSession', async (_, sessionId) => plotAgentService.deleteRealtimeSession(String(sessionId || '').trim()))

  // ---- Excel Analysis IPC ----
  // Wire the log sink: broadcasts excel:envLog and excel:envStatus to all windows.
  setExcelAnalysisLogSink((channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send(channel, payload) } catch { /* window may be closing */ }
    }
  })

  ipcMain.handle('excel:checkEnvStatus', async () => checkExcelEnvStatus())
  ipcMain.handle('excel:rebuildEnv', async () => rebuildExcelEnv())
  ipcMain.handle('excel:pythonDiagnostics', async () => runExcelPythonDiagnostics())

  ipcMain.handle('excel:analysisRun', async (event, payload) => {
    const settings = await store.resolveEffectiveSettings()
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const input = payload as { workspacePath: string; sourcePath: string; userRequirement: string; dataModelId?: string }
    return runExcelAnalysis(settings, input, (phase: string) => {
      safelySendToWindow(senderWindow, 'excel:analysisProgress', { phase })
    })
  })
  ipcMain.handle('excel:listDataModels', async () => listBundledPlotDataModels())

  ipcMain.handle('documentEngine:getActive', () => documentEngineService.getActiveEngine())
  ipcMain.handle('documentEngine:setPreferred', (_, engineId) => documentEngineService.setPreferredEngine(String(engineId)))
  ipcMain.handle('documentEngine:readOoxmlPackage', async (_, filePath) => documentEngineService.readOoxmlPackage(String(filePath)))
  ipcMain.handle('documentEngine:writeOoxmlPackage', async (_, filePath, payload) => documentEngineService.writeOoxmlPackage(String(filePath), payload as any))

  // ---- 正式模板模式 IPC（formal template mode） ----
  ipcMain.handle('formalTemplate:analyze', async (_, payload) => {
    return formalTemplateService.analyze(payload)
  })
  ipcMain.handle('formalTemplate:confirmFields', async (_, payload) => {
    return formalTemplateService.confirmFields(payload)
  })
  ipcMain.handle('formalTemplate:preview', async (_, payload) => {
    return formalTemplateService.preview(payload)
  })
  ipcMain.handle('formalTemplate:commit', async (_, payload) => {
    return formalTemplateService.commit(payload)
  })

  ipcMain.handle('workspace:list', async () => workspaceService.listWorkspaces())
  ipcMain.handle('workspace:create', async (_, name, parentDir) => workspaceService.createWorkspace(String(name), parentDir ? String(parentDir) : undefined))
  ipcMain.handle('workspace:rename', async (_, wsPath, nextName) => workspaceService.renameWorkspace(String(wsPath), String(nextName)))
  ipcMain.handle('workspace:register', async (_, wsPath) => workspaceService.registerWorkspace(String(wsPath)))
  ipcMain.handle('workspace:tree', async (_, wsPath) => workspaceService.getWorkspaceTree(String(wsPath)))
  ipcMain.handle('workspace:readDocumentSchema', async (_, wsPath) => workspaceService.readWorkspaceDocumentSchema(String(wsPath)))
  ipcMain.handle('workspace:saveDocumentSchema', async (_, wsPath, document) => {
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    const result = await workspaceService.saveWorkspaceDocumentSchema(String(wsPath), document as any)
    const durationMs = Date.now() - t0
    try {
      const doc = document as Record<string, unknown> | undefined
      const fileName = String(doc?.name ?? path.basename(String(wsPath)))
      userActionLogService.appendAction({
        module: 'workspace',
        action: 'saveDocumentSchema',
        eventType: 'file_saved',
        targetType: inferFileType(fileName),
        targetTitle: fileName,
        startedAt,
        durationMs,
        status: 'success',
        details: { fileName, fileType: inferFileType(fileName), pathHash: createPathHash(String(wsPath)), operation: 'save', sourceModule: 'workspace' },
      })
    } catch { /* never crash main logic */ }
    return result
  })
  ipcMain.handle('workspace:saveGeneratedPaperJsonArtifact', async (_, input) => workspaceService.saveGeneratedPaperJsonArtifact({
    workspacePath: String(input?.workspacePath || ''),
    documentSchema: input?.documentSchema as any,
    title: typeof input?.title === 'string' ? input.title : undefined,
  }))
  ipcMain.handle('workspace:delete', async (_, wsPath) => workspaceService.deleteWorkspace(String(wsPath)))
  ipcMain.handle('workspace:detectProjectStructure', async (_, wsPath) => workspaceService.detectProjectStructure(String(wsPath)))
  ipcMain.handle('workspace:createFolder', async (_, wsPath, relativePath) => workspaceService.createWorkspaceFolder(String(wsPath), String(relativePath)))
  ipcMain.handle('workspace:createFile', async (_, wsPath, relativePath) => workspaceService.createWorkspaceFile(String(wsPath), String(relativePath)))
  ipcMain.handle('workspace:createBlankDocument', async (_, wsPath, relativePath) => workspaceService.createBlankDocument(String(wsPath), String(relativePath)))
  ipcMain.handle('workspace:renamePath', async (_, wsPath, oldRelativePath, newRelativePath) => workspaceService.renameWorkspacePath(String(wsPath), String(oldRelativePath), String(newRelativePath)))
  ipcMain.handle('workspace:copyPath', async (_, wsPath, sourceRelativePath, targetRelativePath) => workspaceService.copyWorkspacePath(String(wsPath), String(sourceRelativePath), String(targetRelativePath)))
  ipcMain.handle('workspace:movePath', async (_, wsPath, sourceRelativePath, targetRelativePath) => workspaceService.moveWorkspacePath(String(wsPath), String(sourceRelativePath), String(targetRelativePath)))
  ipcMain.handle('workspace:deletePath', async (_, wsPath, relativePath) => workspaceService.deleteWorkspacePath(String(wsPath), String(relativePath)))
  ipcMain.handle('workspace:readReferences', async (_, wsPath, documentPath) => workspaceService.readReferences(String(wsPath), typeof documentPath === 'string' ? documentPath : undefined))
  ipcMain.handle('workspace:readTaskHistory', async (_, wsPath) => workspaceService.readTaskHistory(String(wsPath)))
  ipcMain.handle('workspace:appendTaskHistory', async (_, wsPath, task) => workspaceService.appendTaskHistory(String(wsPath), (task || {}) as Record<string, unknown>))
  ipcMain.handle('workspace:saveReferences', async (_, wsPath, references, documentPath) => workspaceService.saveReferences(String(wsPath), references, typeof documentPath === 'string' ? documentPath : undefined))
  ipcMain.handle('workspace:appendReferences', async (_, wsPath, references, documentPath) => workspaceService.appendReferences(String(wsPath), references, typeof documentPath === 'string' ? documentPath : undefined))
  ipcMain.handle('workspace:cropImage', async (_, wsPath, srcUrl, x, y, w, h, filename) => {
    const srcStr = String(srcUrl)
    let img: Electron.NativeImage
    if (srcStr.startsWith('data:')) {
      img = nativeImage.createFromDataURL(srcStr)
    } else {
      let filePath = srcStr
      if (srcStr.startsWith('file://')) {
        const stripped = decodeURIComponent(srcStr.replace(/^file:\/\//, ''))
        if (/^\/[a-zA-Z]:\//.test(stripped)) {
          filePath = stripped.slice(1).replace(/\//g, path.sep)
        } else if (/^[a-zA-Z]:\//.test(stripped)) {
          filePath = stripped.replace(/\//g, path.sep)
        } else {
          filePath = stripped
        }
      }
      img = nativeImage.createFromPath(filePath)
    }
    if (img.isEmpty()) throw new Error(`无法加载图片: ${srcUrl}`)
    const { width: imgW, height: imgH } = img.getSize()
    const cropX = Math.max(0, Math.round(Number(x)))
    const cropY = Math.max(0, Math.round(Number(y)))
    const cropW = Math.max(1, Math.min(Math.round(Number(w)), imgW - cropX))
    const cropH = Math.max(1, Math.min(Math.round(Number(h)), imgH - cropY))
    const cropped = img.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
    const base64Data = cropped.toPNG().toString('base64')
    const saved = await workspaceService.saveImageToWorkspace(String(wsPath), String(filename), base64Data)
    return { ...saved, dataUrl: `data:image/png;base64,${base64Data}` }
  })
  ipcMain.handle('workspace:saveImageToWorkspace', async (_, wsPath, filename, base64Data) => workspaceService.saveImageToWorkspace(String(wsPath), String(filename), String(base64Data)))
  ipcMain.handle('workspace:saveImageToFiguresBase64', async (_, wsPath, filename, base64Data) => workspaceService.saveImageToFiguresBase64(String(wsPath), String(filename), String(base64Data)))
  ipcMain.handle('workspace:saveImageFromUrl', async (_, wsPath, imageUrl, filename) => workspaceService.saveImageFromUrl(String(wsPath), String(imageUrl), filename ? String(filename) : undefined, false))
  ipcMain.handle('workspace:saveImageToFigures', async (_, wsPath, imageUrl, filename) => workspaceService.saveImageFromUrl(String(wsPath), String(imageUrl), filename ? String(filename) : undefined, true))
  ipcMain.handle('workspace:writeFile', async (_, wsPath, relativePath, content) => workspaceService.writeWorkspaceFile(String(wsPath), String(relativePath), String(content)))
  ipcMain.handle('workspace:saveManuscript', async (_, wsPath, content, filename, options) => {
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    const knowledgeService = await getDefaultKnowledgeService()
    const templateSourcePath = await resolveKnowledgeWordTemplatePath(
      knowledgeService,
      (options as SaveManuscriptOptions | undefined)?.templateDocumentId,
    )
    const result = await workspaceService.saveManuscript(String(wsPath), String(content), String(filename), templateSourcePath)
    const durationMs = Date.now() - t0
    try {
      const fname = String(filename)
      userActionLogService.appendAction({
        module: 'workspace',
        action: 'saveManuscript',
        eventType: 'file_saved',
        targetType: inferFileType(fname),
        targetTitle: fname,
        startedAt,
        durationMs,
        status: 'success',
        details: { fileName: fname, fileType: inferFileType(fname), pathHash: createPathHash(String(wsPath)), sizeBytes: Buffer.byteLength(String(content), 'utf-8'), operation: 'save', sourceModule: 'workspace' },
      })
    } catch { /* never crash main logic */ }
    return result
  })
  ipcMain.handle('workspace:saveExperimentPlan', async (_, wsPath, content, filename) => workspaceService.saveExperimentPlan(String(wsPath), String(content), String(filename)))

  // ---- Department IPC (remote knowledge base) ----
  ipcMain.handle('department:list', async () => {
    try {
      const list = await remoteKB.listKnowledgeBases()
      // Always apply local hierarchy from PRESET_DEPARTMENTS (authoritative for known KBs)
      const parentMap = new Map(PRESET_DEPARTMENTS.filter(p => p.parentId).map(p => [p.id, p.parentId!]))
      for (const dept of list) {
        const pid = parentMap.get(dept.id)
        if (pid) dept.parentId = pid
      }
      return list
    } catch (err) {
      console.error('[department:list] remote KB error, falling back to local', err)
      return departmentService.listDepartments()
    }
  })
  ipcMain.handle('department:create', async (_, name, nameEn) => departmentService.createDepartment(String(name || ''), String(nameEn || '')))
  ipcMain.handle('department:rename', async (_, id, name, nameEn) => departmentService.renameDepartment(String(id || ''), String(name || ''), String(nameEn || '')))
  ipcMain.handle('department:delete', async (_, id) => departmentService.deleteDepartment(String(id || '')))
  ipcMain.handle('department:getDefault', async () => departmentService.getDefaultDepartmentId())

  // ---- Personal Library IPC ----
  ipcMain.handle('personal-lib:listFolders', async () => personalLibraryService.listFolders())
  ipcMain.handle('personal-lib:createFolder', async (_, name) => personalLibraryService.createFolder(String(name || '')))
  ipcMain.handle('personal-lib:renameFolder', async (_, id, name) => personalLibraryService.renameFolder(String(id || ''), String(name || '')))
  ipcMain.handle('personal-lib:deleteFolder', async (_, id) => personalLibraryService.deleteFolder(String(id || '')))
  ipcMain.handle('personal-lib:listFiles', async (_, folderId) => {
    const folderIdArg = folderId === undefined ? undefined : (folderId === null || folderId === '__all__' ? null : String(folderId))
    return personalLibraryService.listFiles(folderIdArg)
  })
  ipcMain.handle('personal-lib:getFile', async (_, fileId) => personalLibraryService.getFile(String(fileId || '')))
  ipcMain.handle('personal-lib:getFileContent', async (_, fileId) => personalLibraryService.getFileContent(String(fileId || '')))
  ipcMain.handle('personal-lib:deleteFile', async (_, fileId) => personalLibraryService.deleteFile(String(fileId || '')))
  ipcMain.handle('personal-lib:moveFile', async (_, fileId, targetFolderId) => {
    const tid = targetFolderId === null || targetFolderId === undefined || targetFolderId === '__none__' ? null : String(targetFolderId)
    return personalLibraryService.moveFile(String(fileId || ''), tid)
  })
  ipcMain.handle('personal-lib:importFiles', async (event, folderId) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined
    const folderIdArg = folderId === null || folderId === undefined || folderId === '__none__' ? null : String(folderId)
    return personalLibraryService.importFiles(ownerWindow ?? null, folderIdArg)
  })

  // ---- Email IPC ----
  const emailService = new EmailService(app.getPath('userData'))
  const credentialService = new CredentialService(app.getPath('userData'))

  /**
   * Normalise an email address: strip "Display Name <addr>" wrapper, trim, lowercase.
   * Used when validating/overriding the From field for fromPolicy='same_as_login'.
   */
  function normalizeEmailAddress(value: string): string {
    if (!value) return ''
    const m = value.match(/<([^>]+)>/)
    return (m ? m[1] : value).trim().toLowerCase()
  }

  /**
   * For school Exchange accounts, the password is stored in safeStorage, not in the
   * JSON config.  This helper injects the decrypted password before any email operation.
   */
  async function injectCredential(config: EmailAccountConfig | null): Promise<EmailAccountConfig | null> {
    if (!config) return null
    if (config.credentialRef && !config.password) {
      const password = await credentialService.getCredential(config.credentialRef)
      if (password) return { ...config, password }
    }
    return config
  }

  /** Convert FetchedMail → MailItem shape expected by the renderer */
  function toMailItem(m: FetchedMail) {
    return {
      id: m.id,
      from: m.from,
      fromName: m.fromName,
      to: m.to,
      toName: m.toName,
      subject: m.subject,
      body: m.body,
      htmlBody: m.htmlBody,
      timestamp: m.timestamp,
      unread: m.unread,
      replied: false,
      threadId: undefined,
      isLoopback: false,
      folder: m.folder as 'inbox' | 'sent' | 'trash' | 'spam',
      attachments: m.attachments.map((a: EmailAttachmentMeta) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        tempPath: a.tempPath,
      })),
      messageId: m.messageId,
    }
  }

  function toEmailIpcError(err: unknown, context: 'imap' | 'smtp' | 'mime' = 'imap', providerType?: string) {
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as NodeJS.ErrnoException & { command?: unknown }).code
    const command = typeof (err as { command?: unknown }).command === 'string'
      ? (err as { command?: string }).command
      : undefined
    const responseCode = (() => {
      const value = (err as { responseCode?: unknown }).responseCode
      return typeof value === 'number' || typeof value === 'string' ? value : undefined
    })()
    const errorCode = classifyEmailError(err, context)
    const isInternalImap = providerType === 'internal-imap'
    const needsModernAuth = !isInternalImap &&
      /OAuth2|Modern Auth|basic auth|普通密码直连|Authentication|LOGIN|auth/i.test(message)
    return {
      ok: false,
      error: {
        message: needsModernAuth
          ? `${message}\n可能需要 OAuth2 / Modern Auth，而不是普通密码直连。`
          : message,
        code,
        command,
        responseCode,
        errorCode,
        needsModernAuth,
      },
    }
  }

  const dangerousMailAttachmentExtensions = new Set([
    '.exe', '.bat', '.cmd', '.com', '.js', '.jse', '.vbs', '.vbe', '.wsf', '.wsh',
    '.msi', '.ps1', '.psm1', '.scr', '.pif', '.lnk', '.reg',
  ])

  const workInboxAttachmentFixtures = new Map<string, { fileName: string; mimeType: string }>([
    ['campus_notice_docx', {
      fileName: 'AI Office校园宣讲会通知-待修改.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }],
  ])

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function sanitizeMailAttachmentFileName(rawName: string): string {
    const baseName = path.basename(String(rawName || '').replace(/^['"]|['"]$/g, ''))
    const cleaned = baseName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/^\.+/, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
    return cleaned || `attachment-${Date.now()}`
  }

  function sanitizeMailPathSegment(rawValue: string, fallback: string): string {
    const cleaned = String(rawValue || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/^\.+/, '_')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, 120)
    return cleaned || fallback
  }

  function inferMailAttachmentMimeType(fileName: string, explicitMimeType?: string): string {
    const normalized = String(explicitMimeType || '').trim()
    if (normalized) return normalized
    const ext = path.extname(fileName).toLowerCase()
    if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    if (ext === '.pptm') return 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'
    if (ext === '.ppt') return 'application/vnd.ms-powerpoint'
    if (ext === '.pdf') return 'application/pdf'
    return 'application/octet-stream'
  }

  function resolveBundledWorkInboxAttachmentPath(fixtureKey: string): string {
    const fixture = workInboxAttachmentFixtures.get(fixtureKey)
    if (!fixture) throw new Error('未知工作邮箱附件资源')
    const root = app.isPackaged
      ? path.join(process.resourcesPath || '', 'data', 'work-inbox-attachments')
      : path.join(app.getAppPath(), 'electron', 'main', 'data', 'work-inbox-attachments')
    return path.join(root, fixture.fileName)
  }

  async function resolveImapAttachmentCachePath(input: {
    messageId: string
    fileName: string
    attachmentId?: string
    partId?: string
  }): Promise<string> {
    const rawMessageId = String(input.messageId || '').replace(/^email:/, '')
    const messageSegment = sanitizeMailPathSegment(rawMessageId, 'message')
    const attachmentDir = path.join(emailService.getAttachmentsDir(), messageSegment)
    const baseDir = path.resolve(emailService.getAttachmentsDir())
    const resolvedDir = path.resolve(attachmentDir)
    if (resolvedDir !== baseDir && !resolvedDir.startsWith(`${baseDir}${path.sep}`)) {
      throw new Error('非法附件缓存路径')
    }

    const entries = await fs.readdir(resolvedDir, { withFileTypes: true }).catch(() => [])
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    if (files.length === 0) throw new Error('附件缓存已过期，请刷新邮件后重试')

    const safeRequestedName = sanitizeMailAttachmentFileName(input.fileName)
    const partId = String(input.partId || '').trim()
    const attachmentId = String(input.attachmentId || '').trim()
    const matched = files.find((fileName) => {
      const stripped = fileName.replace(/^\d+_/, '')
      if (stripped === safeRequestedName || stripped === input.fileName) return true
      if (partId && fileName.startsWith(`${partId}_`)) return true
      return Boolean(attachmentId && attachmentId.endsWith(`::${stripped}`))
    }) || (files.length === 1 ? files[0] : null)

    if (!matched) throw new Error('未找到匹配的 IMAP 附件缓存')
    const target = path.resolve(resolvedDir, matched)
    if (!target.startsWith(`${resolvedDir}${path.sep}`)) {
      throw new Error('非法附件缓存路径')
    }
    return target
  }

  ipcMain.handle('mail:openAttachmentInWorkspace', async (_event, payload: unknown) => {
    try {
      if (!isRecord(payload)) throw new Error('附件打开参数无效')
      const messageId = String(payload.messageId || '').trim()
      const rawFileName = String(payload.fileName || '').trim()
      const workspacePath = String(payload.workspacePath || '').trim()
      if (!messageId) throw new Error('缺少 messageId')
      if (!rawFileName) throw new Error('缺少附件文件名')
      if (!workspacePath) throw new Error('缺少当前工作区路径')

      const safeFileName = sanitizeMailAttachmentFileName(rawFileName)
      const extension = path.extname(safeFileName).toLowerCase()
      if (dangerousMailAttachmentExtensions.has(extension)) {
        throw new Error('出于安全原因，不能打开该类型的邮件附件')
      }
      const openTarget =
        extension === '.docx' || extension === '.md' || extension === '.txt'
          ? 'document'
          : extension === '.xlsx' || extension === '.csv'
            ? 'spreadsheet'
            : extension === '.pptx' || extension === '.pptm' || extension === '.ppt'
              ? 'presentation'
              : 'preview'

      await workspaceService.detectProjectStructure(workspacePath)
      const source = payload.source === 'imap' ? 'imap' : 'work-inbox'
      const fixtureKey = String(payload.fixtureKey || '').trim()
      const sourcePath = source === 'imap'
        ? await resolveImapAttachmentCachePath({
            messageId,
            fileName: rawFileName,
            attachmentId: typeof payload.attachmentId === 'string' ? payload.attachmentId : undefined,
            partId: typeof payload.partId === 'string' ? payload.partId : undefined,
          })
        : resolveBundledWorkInboxAttachmentPath(fixtureKey)

      if (!(await pathExists(sourcePath))) {
        throw new Error(source === 'imap' ? '附件缓存已过期，请刷新邮件后重试' : '工作邮箱附件资源不存在')
      }

      const saved = await saveEmailAttachmentToWorkspace({
        sourcePath,
        workspacePath,
        filename: safeFileName,
        messageId,
        kind: openTarget,
      })

      const mimeType = inferMailAttachmentMimeType(safeFileName, typeof payload.mimeType === 'string' ? payload.mimeType : undefined)
      return {
        ok: true,
        filePath: saved.localPath,
        fileName: safeFileName,
        mimeType,
        openTarget,
        sourceContext: {
          source: 'mail-attachment',
          messageId,
          subject: String(payload.subject || ''),
          fromName: String(payload.fromName || ''),
          fromEmail: String(payload.fromEmail || ''),
          originalAttachmentName: safeFileName,
        },
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          errorCode: 'MAIL_ATTACHMENT_OPEN_FAILED',
        },
      }
    }
  })

  ipcMain.handle('email:getAccount', async () => {
    try {
      return await emailService.loadConfig()
    } catch {
      return null
    }
  })
  ipcMain.handle('email:saveAccount', async (_, config: EmailAccountConfig) => {
    try {
      await emailService.saveConfig(config)
      return { ok: true }
    } catch (err) {
      return toEmailIpcError(err)
    }
  })
  ipcMain.handle('email:clearAccount', async () => {
    try {
      // Also delete stored credential for school Exchange accounts
      const config = await emailService.loadConfig().catch(() => null)
      if (config?.credentialRef) {
        await credentialService.deleteCredential(config.credentialRef).catch(() => {/* ignore */})
      }
      await emailService.clearConfig()
      await emailService.clearAttachmentsCache()
      return { ok: true }
    } catch (err) {
      return toEmailIpcError(err)
    }
  })
  ipcMain.handle('email:testConnection', async (_, config: EmailAccountConfig) => {
    try {
      return await emailService.testConnection(config)
    } catch (err) {
      const structured = toEmailIpcError(err, 'imap', config?.providerType)
      return { ok: false, message: structured.error.message, error: structured.error }
    }
  })
  ipcMain.handle('email:testSmtp', async (_, config: EmailAccountConfig) => {
    try {
      return await emailService.testSmtpConnection(config)
    } catch (err) {
      const structured = toEmailIpcError(err, 'smtp', config?.providerType)
      return { ok: false, message: structured.error.message, error: structured.error }
    }
  })
  ipcMain.handle('email:fetchInbox', async () => {
    try {
      const raw = await emailService.loadConfig()
      if (!raw) return { ok: true, mails: [] }
      const config = await injectCredential(raw)
      // Detect credential-injection failure early and return a clear error
      if (!config?.password) {
        console.warn('[email:fetchInbox] credential not found for account', {
          provider: raw.provider || raw.providerType || 'unknown',
          credentialRef: raw.credentialRef,
        })
        return {
          ok: false,
          error: {
            message: '无法读取邮箱凭据，请重新打开邮件设置并点击"保存并连接"。',
            errorCode: 'AUTH_FAILED',
          },
        }
      }
      console.info('[email:fetchInbox:start]', {
        provider: config.provider || config.providerType || 'unknown',
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapEncryption: config.imapEncryption ?? (config.imapSecure ? 'ssl' : 'starttls'),
        mailbox: 'INBOX',
        fetchLimit: 50,
      })
      const mails = await emailService.fetchInbox(config)
      console.info('[email:fetchInbox:done]', { fetchedCount: mails.length })
      return { ok: true, mails: mails.map(toMailItem) }
    } catch (err) {
      const config = await emailService.loadConfig().catch(() => null)
      return toEmailIpcError(err, 'imap', config?.providerType)
    }
  })
  ipcMain.handle('email:fetchSent', async () => {
    try {
      const raw = await emailService.loadConfig()
      if (!raw) return { ok: true, mails: [] }
      const config = await injectCredential(raw)
      const mails = await emailService.fetchSent(config!)
      return { ok: true, mails: mails.map(toMailItem) }
    } catch (err) {
      return toEmailIpcError(err)
    }
  })
  ipcMain.handle('email:fetchTrash', async () => {
    try {
      const raw = await emailService.loadConfig()
      if (!raw) return { ok: true, mails: [] }
      const config = await injectCredential(raw)
      const [trash, spam] = await Promise.all([
        emailService.fetchTrash(config!).catch(() => []),
        emailService.fetchSpam(config!).catch(() => []),
      ])
      return { ok: true, mails: [...trash, ...spam].map(toMailItem) }
    } catch (err) {
      return toEmailIpcError(err)
    }
  })
  ipcMain.handle('email:send', async (_, options) => {
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    try {
      const raw = await emailService.loadConfig()
      if (!raw) throw new Error('邮件账号未配置，请先在邮件设置中填写账号信息')
      const config = (await injectCredential(raw))!

      // For fromPolicy='same_as_login', always force-override From to the authenticated account address.
      // The renderer may supply mail.to (which could differ in case, name format, or be a fallback
      // placeholder) – override silently rather than rejecting.
      const accountEmail = config.user || config.email || config.username || ''
      if (config.fromPolicy === 'same_as_login') {
        const draftFrom = options?.from ?? ''
        if (draftFrom && normalizeEmailAddress(draftFrom) !== normalizeEmailAddress(accountEmail)) {
          console.warn('[email:send] from override – draft.from="' + draftFrom + '" → account="' + accountEmail + '"')
        }
        options = { ...options, from: accountEmail, fromName: options?.fromName || accountEmail }
      }
      const finalFrom = options?.from ?? accountEmail
      console.log('[email:send] resolved', {
        provider: config.provider || config.providerType,
        email: config.email || config.user,
        authUser: accountEmail,
        finalFrom,
        to: options?.to,
        subject: String(options?.subject ?? '').slice(0, 60),
        inReplyTo: options?.inReplyTo ? String(options.inReplyTo).slice(0, 80) : undefined,
      })

      await emailService.sendEmail(config, options)

      // Non-fatal: try to append a copy to the IMAP Sent folder
      let appendedToSent = false
      let appendWarning: string | undefined
      try {
        const rawMessage = emailService.buildRawMimeMessage(options)
        await emailService.appendToSent(config, rawMessage)
        appendedToSent = true
      } catch (appendErr) {
        const msg = appendErr instanceof Error ? appendErr.message : String(appendErr)
        console.warn('[EmailService] appendToSent failed (non-fatal):', msg)
        appendWarning = '邮件已发送，但保存到已发送失败'
      }

      try {
        const opts = options as Record<string, unknown> | undefined ?? {}
        const subject = String(opts.subject ?? '')
        const to: string[] = Array.isArray(opts.to) ? opts.to as string[] : typeof opts.to === 'string' ? [opts.to] : []
        const cc: string[] = Array.isArray(opts.cc) ? opts.cc as string[] : typeof opts.cc === 'string' ? [opts.cc] : []
        const bcc: string[] = Array.isArray(opts.bcc) ? opts.bcc as string[] : typeof opts.bcc === 'string' ? [opts.bcc] : []
        const attachments: unknown[] = Array.isArray(opts.attachments) ? opts.attachments : []
        userActionLogService.appendAction({
          module: 'email',
          action: 'send',
          eventType: 'email_sent',
          startedAt,
          durationMs: Date.now() - t0,
          status: 'success',
          details: {
            subjectSummary: subject.slice(0, 30),
            toDomains: to.map((addr) => addr.includes('@') ? addr.split('@')[1] : addr),
            ccCount: cc.length,
            bccCount: bcc.length,
            attachmentCount: attachments.length,
          },
        })
      } catch { /* never crash main logic */ }

      return { ok: true, appendedToSent, appendWarning }
    } catch (err) {
      try {
        userActionLogService.appendAction({
          module: 'email',
          action: 'send',
          eventType: 'error_occurred',
          startedAt,
          durationMs: Date.now() - t0,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      } catch { /* never crash main logic */ }
      return toEmailIpcError(err, 'smtp')
    }
  })

  ipcMain.handle('email:deleteMessage', async (_, { mailId, folder }: { mailId: string; folder: 'inbox' | 'sent' }) => {
    try {
      const raw = await emailService.loadConfig()
      if (!raw) throw new Error('邮箱未配置，请先在邮件设置中填写账号信息')
      const config = (await injectCredential(raw))!
      await emailService.moveMessageToTrash(config, mailId, folder)
      return { ok: true }
    } catch (err) {
      const config = await emailService.loadConfig().catch(() => null)
      return toEmailIpcError(err, 'imap', config?.providerType)
    }
  })

  ipcMain.handle('email:restoreMessage', async (_, { mailId, folder }: { mailId: string; folder: 'trash' | 'spam' }) => {
    try {
      const raw = await emailService.loadConfig()
      if (!raw) throw new Error('邮箱未配置，请先在邮件设置中填写账号信息')
      const config = (await injectCredential(raw))!
      await emailService.restoreMessageToInbox(config, mailId, folder === 'spam' ? 'spam' : 'trash')
      return { ok: true }
    } catch (err) {
      const config = await emailService.loadConfig().catch(() => null)
      return toEmailIpcError(err, 'imap', config?.providerType)
    }
  })

  /* ---- School Exchange IPC ---- */

  ipcMain.handle('email:testSchoolAccount', async (_, params: {
    email: string
    password: string
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
  }) => {
    try {
      return await emailService.autoProbeSchoolExchange(params)
    } catch (err) {
      return {
        ok: false,
        probeResults: [{ protocol: 'imap' as const, mode: 'starttls' as const, ok: false, message: err instanceof Error ? err.message : String(err) }],
      }
    }
  })

  ipcMain.handle('email:saveSchoolAccount', async (_, config: EmailAccountConfig & { password: string }) => {
    try {
      const { password, ...rest } = config
      // Securely store the password; do not write it to JSON
      const credentialRef = rest.credentialRef || rest.user
      await credentialService.saveCredential(credentialRef, password)
      const configToSave: EmailAccountConfig = {
        ...rest,
        password: '',  // never persisted
        credentialRef,
        provider: 'school_cuhk_exchange_imap_smtp' as const,
        fromPolicy: 'same_as_login' as const,
        username: rest.username || rest.user,
        allowSelfSignedCerts: true,
      }
      await emailService.saveConfig(configToSave)
      console.info('[email:saveSchoolAccount] saved', {
        provider: configToSave.provider,
        imapHost: configToSave.imapHost,
        imapPort: configToSave.imapPort,
        imapEncryption: configToSave.imapEncryption,
        smtpHost: configToSave.smtpHost,
        smtpPort: configToSave.smtpPort,
        smtpEncryption: configToSave.smtpEncryption,
        credentialRef: configToSave.credentialRef,
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  })

  ipcMain.handle('email:removeSchoolAccount', async () => {
    try {
      const config = await emailService.loadConfig().catch(() => null)
      if (config?.credentialRef) {
        await credentialService.deleteCredential(config.credentialRef).catch(() => {/* ignore */})
      }
      await emailService.clearConfig()
      await emailService.clearAttachmentsCache()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  })

  ipcMain.handle('email:downloadAttachment', async (event, { tempPath, filename }: { tempPath: string; filename: string }) => {
    try {
      // Security: ensure tempPath is within the managed attachments directory
      const base = path.normalize(emailService.getAttachmentsDir())
      const target = path.normalize(tempPath)
      if (!target.startsWith(base + path.sep) && target !== base) {
        return { ok: false, error: { message: '非法附件路径', errorCode: 'UNKNOWN_ERROR' } }
      }
      // Verify file exists before showing dialog
      try {
        await fs.access(target)
      } catch {
        return { ok: false, error: { message: '附件文件已过期，请刷新邮件后重试', errorCode: 'IMAP_FETCH_FAILED' } }
      }
      const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
      const result = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, {
            defaultPath: filename,
            title: '保存附件',
          })
        : await dialog.showSaveDialog({
            defaultPath: filename,
            title: '保存附件',
          })
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true }
      }
      await fs.copyFile(target, result.filePath)
      return { ok: true, canceled: false, savedPath: result.filePath }
    } catch (err) {
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err), errorCode: 'UNKNOWN_ERROR' } }
    }
  })

  ipcMain.handle('email:selectAttachments', async (event) => {
    try {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
      const dialogOptions = {
        title: '选择附件',
        properties: ['openFile', 'multiSelections'] as OpenDialogOptions['properties'],
        filters: [
          { name: '办公文件', extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'zip'] },
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      }
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, files: [] }
      }
      const extMimeMap: Record<string, string> = {
        pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        txt: 'text/plain', zip: 'application/zip',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      }
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const stat = await fs.stat(filePath)
          const fileName = path.basename(filePath)
          const ext = path.extname(filePath).replace('.', '').toLowerCase()
          const mimeType = extMimeMap[ext] ?? 'application/octet-stream'
          return { fileName, filePath, mimeType, sizeBytes: stat.size }
        }),
      )
      return { ok: true, files }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- Knowledge IPC (remote API with local fallback) ----
  ipcMain.handle('knowledge:getInfo', async (_, departmentId) => {
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    try {
      const kb = await remoteKB.getKnowledgeBase(deptId)
      if (kb) return { rootPath: '', documentCount: kb.fileCount, totalChunks: 0, departmentId: deptId }
    } catch { /* fallback */ }
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return knowledgeService.getInfo()
  })
  ipcMain.handle('knowledge:listDocuments', async (_, departmentId, query) => {
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    try {
      let docs = await remoteKB.listFiles(deptId)
      if (typeof query === 'string' && query.trim()) {
        const q = query.trim().toLowerCase()
        docs = docs.filter((d) => d.title.toLowerCase().includes(q) || d.originalName.toLowerCase().includes(q))
      }
      return docs
    } catch { /* fallback */ }
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return knowledgeService.listDocuments(typeof query === 'string' ? query : undefined)
  })
  ipcMain.handle('knowledge:getDocument', async (_, departmentId, documentId) => {
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    const docId = String(documentId || '').trim()
    try {
      const detail = await remoteKB.getDocumentDetail(deptId, docId)

      // For reading seeds, replace remote plain-text with local raw Markdown
      // Remote /qa endpoint strips Markdown formatting; read local .md files instead
      if (deptId === 'classic-reading' || deptId === 'scientific-papers') {
        const dept = departmentService.getDepartment(String(departmentId || '').trim())
        if (dept) {
          const seedPaths = resolveBundledReadingSeedPaths(dept.nameEn)
          const docName = (detail.meta.title || detail.meta.originalName || '').replace(/\.[^.]+$/, '')
          const matchedSeed = seedPaths.find((fp) => {
            const basename = path.basename(fp, path.extname(fp))
            return basename === docName || basename.includes(docName) || docName.includes(basename)
          })
          if (matchedSeed) {
            try {
              const rawMd = syncFs.readFileSync(matchedSeed, 'utf-8')
              if (rawMd.trim()) {
                detail.extractedText = rawMd
                detail.originalExtractedText = rawMd
                detail.meta.sourceType = 'md'
              }
            } catch { /* keep remote text */ }
          }
        }
      }

      return detail
    } catch { /* fallback */ }
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return knowledgeService.getDocument(docId)
  })
  ipcMain.handle('knowledge:getDocumentVersion', async (_, _departmentId, documentId, versionId) => {
    return { id: String(versionId || ''), documentId: String(documentId || ''), content: '' }
  })
  ipcMain.handle('knowledge:listDocumentChunks', async (_, _departmentId, _payload) => {
    return []
  })
  ipcMain.handle('knowledge:retrieveChunks', async (_, departmentId, payload) => {
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    const p = (payload || {}) as { query?: string; topK?: number; includeDocumentIds?: string[]; requiredReferenceDocumentIds?: string[]; preferredReferenceDocumentIds?: string[] }
    const fileIds = Array.from(new Set([
      ...(Array.isArray(p.includeDocumentIds) ? p.includeDocumentIds : []),
      ...(Array.isArray(p.requiredReferenceDocumentIds) ? p.requiredReferenceDocumentIds : []),
      ...(Array.isArray(p.preferredReferenceDocumentIds) ? p.preferredReferenceDocumentIds : []),
    ].map((item) => String(item || '').trim()).filter(Boolean)))
    try {
      return await remoteKB.qaSearch(deptId, p.query || '', fileIds.length ? fileIds : null, p.topK || 8)
    } catch { /* fallback */ }
    const { retrievalService } = await resolveDeptBundle(departmentId)
    return retrievalService.retrieveChunks((payload || {}) as any)
  })
  ipcMain.handle('knowledge:previewTaskContext', async (_, departmentId, payload) => {
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    const p = (payload || {}) as { instruction?: string; query?: string; topK?: number; constraints?: any }
    const query = p.instruction || p.query || ''
    const targetTopK = p.topK || 8
    const constraints = p.constraints || {}
    const fileIds = Array.from(new Set([
      ...(Array.isArray(constraints.requiredReferenceDocumentIds) ? constraints.requiredReferenceDocumentIds : []),
      ...(Array.isArray(constraints.preferredReferenceDocumentIds) ? constraints.preferredReferenceDocumentIds : []),
    ].map((item) => String(item || '').trim()).filter(Boolean)))
    try {
      const settings = await store.resolveEffectiveSettings()
      const queries = await remoteKB.expandQueryWithLlm(settings, query)
      const perQueryTopK = Math.ceil(targetTopK / queries.length) + 2
      const hitArrays = await Promise.all(
        queries.map((q) => remoteKB.qaSearch(deptId, q, fileIds.length ? fileIds : null, perQueryTopK)),
      )
      const hits = remoteKB.deduplicateHits(hitArrays.flat(), targetTopK)
      return {
        templateSummary: undefined,
        explicitReferenceSummaries: [],
        retrievedHits: hits.map((h) => ({
          chunk: { id: h.chunkId, documentId: h.documentId, text: h.text, pageNo: h.pageNo },
          score: h.score,
          source: 'auto-retrieval' as const,
          matchedBy: ['summary' as const],
          quote: h.text,
        })),
        citations: hits.map((h, i) => ({
          id: `auto-${i}`,
          documentId: h.documentId,
          chunkId: h.chunkId,
          sourceKind: 'auto-retrieval' as const,
          documentTitle: h.documentTitle,
          locatorLabel: `片段 ${i + 1}`,
          quote: h.text,
          score: h.score,
        })),
      }
    } catch { /* fallback */ }
    const { retrievalService } = await resolveDeptBundle(departmentId)
    return retrievalService.previewTaskContext((payload || {}) as any)
  })
  ipcMain.handle('knowledge:materializeWorkspace', async (_, departmentId, payload) => {
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return materializeKnowledgeWorkspace(workspaceService, knowledgeService, (payload || {}) as MaterializeKnowledgeWorkspaceInput)
  })
  ipcMain.handle('knowledge:deleteDocument', async (_, _departmentId, _documentId) => {
    // Deletion managed on server side
    return { ok: true }
  })
  ipcMain.handle('knowledge:saveTaskRecord', async (_, departmentId, payload) => {
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return knowledgeService.saveTaskRecord((payload || {}) as SaveKnowledgeTaskInput)
  })
  ipcMain.handle('knowledge:createRemakeVersion', async (_, departmentId, payload) => {
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return knowledgeService.createRemakeVersion((payload || {}) as CreateKnowledgeRemakeVersionInput)
  })
  ipcMain.handle('knowledge:setCurrentVersion', async (_, departmentId, documentId, versionId) => {
    const { knowledgeService } = await resolveDeptBundle(departmentId)
    return knowledgeService.setCurrentVersion(String(documentId || ''), String(versionId || ''))
  })
  ipcMain.handle('knowledge:submitRemakeTask', async (_, departmentId, payload) => {
    const { taskService } = await resolveDeptBundle(departmentId)
    return taskService.submitRemakeTask((payload || {}) as any)
  })
  ipcMain.handle('knowledge:importDocuments', async (event, departmentId) => {
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Knowledge Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
      ],
    }
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths.length) {
      return { imported: [], duplicates: [], failed: [], canceled: true }
    }
    try {
      const { imported, failed } = await remoteKB.ingestFiles(deptId, result.filePaths)
      return { imported, duplicates: [], failed, canceled: false }
    } catch {
      const { knowledgeService } = await resolveDeptBundle(departmentId)
      const imported = await knowledgeService.importDocuments(result.filePaths)
      return { ...imported, canceled: false }
    }
  })
  ipcMain.handle('knowledge:importDocumentFromPath', async (_, departmentId, filePath) => {
    const normalizedPath = String(filePath || '').trim()
    if (!normalizedPath) {
      return { imported: [], duplicates: [], failed: [], canceled: true }
    }
    const deptId = resolveRemoteKnowledgePartitionId(departmentId)
    try {
      const { imported, failed } = await remoteKB.ingestFiles(deptId, [normalizedPath])
      return { imported, duplicates: [], failed, canceled: false }
    } catch {
      const { knowledgeService } = await resolveDeptBundle(departmentId)
      const imported = await knowledgeService.importDocuments([normalizedPath])
      return { ...imported, canceled: false }
    }
  })
  ipcMain.handle('knowledge:ensureReadingSeeds', async (_, departmentId) => {
    const deptId = String(departmentId || '').trim()
    const department = departmentService.getDepartment(deptId)
    if (!department) {
      return { imported: [], duplicates: [], failed: [] }
    }

    const filePaths = resolveBundledReadingSeedPaths(department.nameEn)
    if (!filePaths.length) {
      return { imported: [], duplicates: [], failed: [] }
    }

    const remotePartitionId = resolveRemoteKnowledgePartitionId(departmentId)
    await remoteKB.ensureKnowledgeBase(remotePartitionId, department.name)
    const { imported, failed } = await remoteKB.ingestFiles(remotePartitionId, filePaths)
    return {
      imported,
      duplicates: [],
      failed: failed.map((filePath) => ({
        filePath,
        fileName: path.basename(filePath),
        error: 'remote-ingest-failed',
      })),
    }
  })
  ipcMain.handle('knowledge:classifyDocument', async (_, _departmentId, _documentId) => {
    return { category: 'unknown' }
  })
  ipcMain.handle('knowledge:updateDocumentCategory', async (_, _departmentId, _documentId, _category) => {
    return { ok: true }
  })
  ipcMain.handle('workspace:importFiles', async (_, wsPath, targetRelDir) => {
    const ws = path.resolve(String(wsPath || '').trim())
    const relDir = String(targetRelDir || '').trim()
    const targetDir = relDir ? path.resolve(ws, relDir) : ws
    if (!targetDir.startsWith(ws)) throw new Error('目标路径不在工作区内')

    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文档', extensions: ['doc', 'docx', 'pdf', 'txt', 'md'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return { imported: [] }

    await fs.mkdir(targetDir, { recursive: true })
    const imported: string[] = []
    for (const sourcePath of result.filePaths) {
      const ext = path.extname(sourcePath)
      const base = path.basename(sourcePath, ext)
      let destName = path.basename(sourcePath)
      let destPath = path.join(targetDir, destName)
      let counter = 1
      while (true) {
        try {
          await fs.access(destPath)
          destName = `${base}_${counter}${ext}`
          destPath = path.join(targetDir, destName)
          counter++
        } catch {
          break
        }
      }
      await fs.copyFile(sourcePath, destPath)
      imported.push(destPath)
    }
    return { imported }
  })

  ipcMain.handle('file:openDialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('file:openDirectoryDialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('file:saveDialog', async (_, defaultName) => {
    const result = await dialog.showSaveDialog({ defaultPath: String(defaultName || 'document.html') })
    return result.canceled ? null : result.filePath
  })
  ipcMain.handle('file:importImage', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const filePath = result.filePaths[0]
    const fileName = path.basename(filePath)
    const contentType = getImageContentType(filePath)
    const buffer = await fs.readFile(filePath)
    return {
      filePath,
      fileName,
      contentType,
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    }
  })
  ipcMain.handle('file:getInfo', async (_, sourcePath) => {
    const normalizedPath = normalizeFileSystemReadPath(String(sourcePath || ''))
    if (!normalizedPath || /^https?:\/\//i.test(normalizedPath) || /^data:/i.test(normalizedPath)) {
      return { exists: false, fileSize: 0, path: normalizedPath }
    }
    try {
      const stat = await fs.stat(normalizedPath)
      return { exists: stat.isFile(), fileSize: stat.isFile() ? stat.size : 0, path: normalizedPath }
    } catch {
      return { exists: false, fileSize: 0, path: normalizedPath }
    }
  })
  ipcMain.handle('file:readImageAsDataUrl', async (_, sourcePath) => {
      const source = String(sourcePath || '').trim()
      if (!source) throw new Error('图片路径不能为空')

      if (/^https?:\/\//i.test(source)) {
        const response = await fetch(source)
        if (!response.ok) {
          throw new Error(`图片下载失败: ${response.status}`)
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        const url = new URL(source)
        const fileName = path.basename(url.pathname) || `image-${Date.now()}.png`
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || getImageContentType(fileName)
        return {
          filePath: source,
          fileName,
          contentType,
          dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
        }
      }

      const normalizedPath = normalizeFileSystemReadPath(source)
      const fileName = path.basename(normalizedPath)
      const contentType = getImageContentType(normalizedPath)
      const buffer = await fs.readFile(normalizedPath)
      return {
        filePath: normalizedPath,
        fileName,
        contentType,
        dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
      }
    })
  ipcMain.handle('file:read', async (_, filePath) => {
    const target = String(filePath)
    const ext = path.extname(target).toLowerCase()
    if (ext === '.docx') {
      const snapshot = await documentEngineService.readOoxmlPackage(target)
      let content = snapshot.html
      let preserveOriginalOnSave = false

      if (!snapshot.exists || !snapshot.documentXml) {
        const result = await mammoth.convertToHtml({ path: target })
        content = result.value || ''
        preserveOriginalOnSave = true
      }

      return {
        type: 'html',
        content,
        filePath: target,
        sourceFormat: 'docx',
        sidecarUsed: false,
        preserveOriginalOnSave,
      }
    }
    if (ext === '.doc') {
      return {
        type: 'doc',
        content: '',
        filePath: target,
      }
    }
    const content = await fs.readFile(target, 'utf-8')
    const plainType = path.extname(target).replace('.', '') || 'txt'
    return { type: plainType, content, filePath: target }
  })
  ipcMain.handle('file:listDirectoryImages', async (_, dirPath) => {
    const target = String(dirPath || '').trim()
    if (!target) return []
    const entries = await fs.readdir(target, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        filePath: path.join(target, entry.name),
      }))
      .filter((entry) => isSupportedImageFile(entry.filePath))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  })
  ipcMain.handle('file:openExternal', async (_, filePath) => {
    const raw = String(filePath || '').trim()
    if (!raw) {
      return { success: false, error: '路径为空', filePath: '' }
    }
    // path.normalize converts forward slashes to OS-native separators (backslashes on Windows),
    // which is required for shell.openPath to succeed on Windows.
    const target = path.normalize(raw)
    // Check path existence before calling shell.openPath to avoid Windows native error dialog
    const exists = syncFs.existsSync(target)
    if (!exists) {
      return { success: false, error: `路径不存在：${target}`, filePath: target }
    }
    const errorMessage = await shell.openPath(target)
    return { success: !errorMessage, error: errorMessage || null, filePath: target }
  })

  /**
   * Safe open-folder: checks existence, optionally creates the directory, and
   * falls back to opening the parent directory when the target is a file.
   */
  ipcMain.handle('file:openFolderSafe', async (_, payload) => {
    const record = (typeof payload === 'object' && payload !== null) ? payload as Record<string, unknown> : {}
    const raw = String(record.targetPath || '').trim()
    const createIfMissing = Boolean(record.createIfMissing)

    if (!raw) {
      return { ok: false, error: '路径为空' }
    }

    const target = path.normalize(raw)

    let stat: import('node:fs').Stats | null = null
    try {
      stat = await fs.stat(target)
    } catch {
      // path does not exist
    }

    if (!stat) {
      if (createIfMissing) {
        try {
          await fs.mkdir(target, { recursive: true })
          stat = await fs.stat(target).catch(() => null)
          if (!stat) {
            return { ok: false, error: `无法创建目录：${target}` }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, error: `创建目录失败：${msg}` }
        }
      } else {
        return { ok: false, error: `该目录不存在，可能已被删除或尚未生成：${target}`, notFound: true }
      }
    }

    // If target is a file, open its parent directory instead
    const openTarget = stat.isFile() ? path.dirname(target) : target
    const errorMessage = await shell.openPath(openTarget)
    if (errorMessage) {
      return { ok: false, error: errorMessage, path: openTarget }
    }
    return { ok: true, path: openTarget }
  })
  ipcMain.handle('url:openExternal', async (_, url) => {
    const target = String(url || '').trim()
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      return { success: false, error: 'Only http/https URLs are allowed' }
    }
    await shell.openExternal(target)
    return { success: true }
  })

  /* ---- Internal Account token storage (file in userData) ---- */
  /* TODO(phase6): migrate to Electron safeStorage for encrypted at-rest storage */
  const _iatUserDataDir = app.getPath('userData')
  const internalAccountTokenPath = path.join(_iatUserDataDir, 'internal-account-token.json')
  const internalAccountSessionPath = path.join(_iatUserDataDir, 'internal-account-session.json')
  const _iatTmpPath = internalAccountTokenPath + '.tmp'

  // Delays (ms) between successive retry attempts on transient Windows file errors
  const _iatRetryDelaysMs = [80, 160, 320, 640, 1000]

  // Serialised write queue — at most one token write in-flight at a time
  let _iatWriteQueue: Promise<unknown> = Promise.resolve()
  let _iatPendingWrites = 0

  const _iatSleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

  async function _iatWriteTokenAtomic(value: string): Promise<void> {
    const content = JSON.stringify({ token: value })

    // Ensure userData directory exists before any file operation
    try {
      syncFs.mkdirSync(_iatUserDataDir, { recursive: true })
    } catch (e: any) {
      console.error(`[IAT] mkdirSync failed userDataDir=${_iatUserDataDir} code=${e?.code} msg=${e?.message}`)
    }

    // Pre-flight: detect and repair known bad states on the target path
    try {
      const st = syncFs.statSync(internalAccountTokenPath)
      if (st.isDirectory()) {
        const bakName = internalAccountTokenPath + `.bak-dir-${Date.now()}`
        console.warn(`[IAT] token path is a directory — renaming to ${bakName}`)
        syncFs.renameSync(internalAccountTokenPath, bakName)
      } else {
        const mode = st.mode & 0o777
        console.log(`[IAT] existing file mode=0o${mode.toString(8)} size=${st.size}`)
        if (!(mode & 0o200)) {
          console.warn(`[IAT] file is read-only mode=0o${mode.toString(8)}, attempting chmod 0o600`)
          try {
            syncFs.chmodSync(internalAccountTokenPath, 0o600)
          } catch (ce: any) {
            console.error(`[IAT] chmod failed code=${ce?.code} msg=${ce?.message}`)
          }
        }
      }
    } catch (se: any) {
      if (se.code !== 'ENOENT') {
        console.warn(`[IAT] pre-flight stat error code=${se.code} msg=${se.message}`)
      }
    }

    // Atomic write: write to .tmp then rename to final path
    // Retries on transient Windows errors (EPERM / EBUSY / EACCES)
    let lastErr: unknown
    for (let attempt = 0; attempt <= _iatRetryDelaysMs.length; attempt++) {
      try {
        await fs.writeFile(_iatTmpPath, content, { encoding: 'utf-8' })
        try {
          await fs.rename(_iatTmpPath, internalAccountTokenPath)
        } catch (renameErr: any) {
          // Windows rename can fail if the target is momentarily locked; fall back to copy
          console.warn(`[IAT] rename failed attempt=${attempt} code=${renameErr?.code} — fallback copy`)
          await fs.copyFile(_iatTmpPath, internalAccountTokenPath)
          try { await fs.unlink(_iatTmpPath) } catch { /* best-effort */ }
        }
        console.log(`[IAT] token written ok pid=${process.pid} attempt=${attempt} path=${internalAccountTokenPath}`)
        return
      } catch (err: any) {
        lastErr = err
        console.warn(`[IAT] write attempt ${attempt} failed code=${err?.code} msg=${err?.message}`)
        try { await fs.unlink(_iatTmpPath) } catch { /* best-effort cleanup of tmp */ }
        if (attempt < _iatRetryDelaysMs.length && ['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) {
          await _iatSleep(_iatRetryDelaysMs[attempt])
          continue
        }
        break
      }
    }
    throw lastErr
  }

  ipcMain.handle('internalAccount:getToken', async () => {
    try {
      const raw = await fs.readFile(internalAccountTokenPath, 'utf-8')
      const parsed = JSON.parse(raw) as { token?: string }
      return { token: typeof parsed.token === 'string' ? parsed.token : null }
    } catch {
      return { token: null }
    }
  })

  ipcMain.handle('internalAccount:setToken', async (_, token: unknown) => {
    const value = typeof token === 'string' ? token : ''
    const pid = process.pid
    const exists = (() => { try { return syncFs.existsSync(internalAccountTokenPath) } catch { return false } })()
    const isDir = exists && (() => { try { return syncFs.statSync(internalAccountTokenPath).isDirectory() } catch { return false } })()
    _iatPendingWrites++
    console.log(`[IAT] setToken pid=${pid} userDataDir=${_iatUserDataDir} tokenPath=${internalAccountTokenPath} exists=${exists} isDir=${isDir} pendingWrites=${_iatPendingWrites}`)

    // Enqueue: each write waits for the previous one to finish (mutex via promise chain)
    let myResolve!: () => void
    let myReject!: (e: unknown) => void
    const mySlot = new Promise<void>((res, rej) => { myResolve = res; myReject = rej })
    const prev = _iatWriteQueue
    _iatWriteQueue = mySlot

    try {
      await prev.catch(() => { /* previous write failure must not block this write */ })
      await _iatWriteTokenAtomic(value)
      myResolve()
      return { ok: true }
    } catch (err: any) {
      console.error(`[IAT] setToken failed pid=${pid} code=${err?.code} msg=${err?.message}`)
      myReject(err)
      throw err
    } finally {
      _iatPendingWrites--
    }
  })

  ipcMain.handle('internalAccount:clearToken', async () => {
    try { await fs.unlink(internalAccountTokenPath) } catch { /* already gone */ }
    return { ok: true }
  })

  ipcMain.handle('internalAccount:getSession', async () => {
    try {
      const raw = await fs.readFile(internalAccountSessionPath, 'utf-8')
      const parsed = JSON.parse(raw) as { session?: unknown }
      return { session: parsed?.session ?? null }
    } catch {
      return { session: null }
    }
  })

  ipcMain.handle('internalAccount:setSession', async (_, sessionData: unknown) => {
    try {
      await fs.mkdir(path.dirname(internalAccountSessionPath), { recursive: true })
      await fs.writeFile(internalAccountSessionPath, JSON.stringify({ session: sessionData }, null, 2), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('internalAccount:clearSession', async () => {
    try { await fs.unlink(internalAccountSessionPath) } catch { /* already gone */ }
    return { ok: true }
  })

  ipcMain.handle('internalAccount:loginMailbox', async (_, payload: unknown) => {
    try {
      const data = (payload ?? {}) as { usernameOrEmail?: string; password?: string }
      const usernameOrEmail = String(data.usernameOrEmail ?? '').trim()
      const password = String(data.password ?? '')
      if (!usernameOrEmail) return { ok: false, error: '请输入用户名或邮箱' }
      if (!password) return { ok: false, error: '请输入密码' }

      const normalizedEmail = usernameOrEmail.includes('@')
        ? usernameOrEmail.toLowerCase()
        : `${usernameOrEmail.toLowerCase()}${SCHOOL_CUHK_EXCHANGE_CONFIG.emailSuffix}`
      const localPart = normalizedEmail.split('@')[0] || usernameOrEmail
      const displayName = localPart

      const probe = await emailService.autoProbeSchoolExchange({
        email: normalizedEmail,
        password,
        imapHost: SCHOOL_CUHK_EXCHANGE_CONFIG.host,
        imapPort: SCHOOL_CUHK_EXCHANGE_CONFIG.imap.port,
        smtpHost: SCHOOL_CUHK_EXCHANGE_CONFIG.host,
        smtpPort: SCHOOL_CUHK_EXCHANGE_CONFIG.smtp.port,
      })
      if (!probe.ok || !probe.imapEncryption || !probe.smtpEncryption) {
        const probeMessage = probe.probeResults.find((item) => !item.ok)?.message || '邮箱连接失败'
        return { ok: false, error: probeMessage, mailboxEmail: normalizedEmail, probeResults: probe.probeResults }
      }

      const credentialRef = normalizedEmail
      await credentialService.saveCredential(credentialRef, password)

      const configToSave: EmailAccountConfig = {
        user: normalizedEmail,
        password: '',
        displayName,
        username: normalizedEmail,
        provider: 'school_cuhk_exchange_imap_smtp',
        credentialRef,
        fromPolicy: 'same_as_login',
        label: '学校邮箱',
        imapHost: SCHOOL_CUHK_EXCHANGE_CONFIG.host,
        imapPort: SCHOOL_CUHK_EXCHANGE_CONFIG.imap.port,
        imapSecure: probe.imapEncryption === 'ssl',
        smtpHost: SCHOOL_CUHK_EXCHANGE_CONFIG.host,
        smtpPort: SCHOOL_CUHK_EXCHANGE_CONFIG.smtp.port,
        smtpSecure: probe.smtpEncryption === 'ssl',
        smtpIgnoreTls: probe.smtpEncryption === 'none',
        imapEncryption: probe.imapEncryption,
        smtpEncryption: probe.smtpEncryption,
        allowSelfSignedCerts: true,
      }
      await emailService.saveConfig(configToSave)

      const sessionData = {
        source: 'mailbox-fallback',
        token: '',
        user: {
          id: `mailbox:${normalizedEmail}`,
          username: localPart,
          displayName,
          email: normalizedEmail,
          roles: ['mailbox-fallback'],
          status: 'active',
          mustChangePassword: false,
        },
        bindings: {
          mail: {
            service: 'mail',
            status: 'active',
            metadata: {
              source: 'mailbox-fallback',
              mailboxEmail: normalizedEmail,
            },
          },
        },
        bindingsPhase: 'success',
        emailAutoStatus: 'applied',
      }

      await fs.mkdir(path.dirname(internalAccountSessionPath), { recursive: true })
      await fs.writeFile(internalAccountSessionPath, JSON.stringify({ session: sessionData }, null, 2), 'utf-8')

      return {
        ok: true,
        mailboxEmail: normalizedEmail,
        session: sessionData,
        probeResults: probe.probeResults,
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /* ---- Matrix session storage (file in userData) ---- */
  /* TODO(phase6): migrate to Electron safeStorage for encrypted at-rest storage */
  const matrixSessionPath = path.join(app.getPath('userData'), 'matrix-session.json')

  ipcMain.handle('matrix:getSession', async () => {
    try {
      const raw = await fs.readFile(matrixSessionPath, 'utf-8')
      const parsed = JSON.parse(raw) as { userId?: string; accessToken?: string; homeserver?: string; deviceId?: string }
      if (typeof parsed.accessToken === 'string' && typeof parsed.userId === 'string') {
        return { session: { userId: parsed.userId, accessToken: parsed.accessToken, homeserver: parsed.homeserver ?? '', deviceId: parsed.deviceId } }
      }
      return { session: null }
    } catch {
      return { session: null }
    }
  })

  ipcMain.handle('matrix:setSession', async (_, sessionData: unknown) => {
    try {
      const s = sessionData as { userId: string; accessToken: string; homeserver: string; deviceId?: string }
      if (!s?.userId || !s?.accessToken) return { ok: false, error: 'invalid session data' }
      // Only persist non-sensitive identity fields + token; never log the token
      const toSave = { userId: s.userId, accessToken: s.accessToken, homeserver: s.homeserver, deviceId: s.deviceId }
      await fs.mkdir(path.dirname(matrixSessionPath), { recursive: true })
      await fs.writeFile(matrixSessionPath, JSON.stringify(toSave), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('matrix:clearSession', async () => {
    try { await fs.unlink(matrixSessionPath) } catch { /* already gone */ }
    return { ok: true }
  })

  /* ---- Internal Account: apply email config (no password) ---- */
  ipcMain.handle('internalAccount:applyEmailConfig', async (_, config: unknown) => {
    try {
      const incoming = config as import('./services/emailService').EmailAccountConfig
      // Only overwrite if:
      // 1. No existing config, OR
      // 2. Existing config is an internal-imap account (auto-applied, not manually configured), OR
      // 3. Existing config belongs to a different user (account switch)
      // If the user manually configured a custom email (providerType !== 'internal-imap'),
      // preserve it and skip the auto-apply.
      const existing = await emailService.loadConfig()
      if (existing) {
        const isInternalConfig = existing.providerType === 'internal-imap'
        const isSameUser = existing.ownerUserId && incoming.ownerUserId && existing.ownerUserId === incoming.ownerUserId
        const isDifferentUser = existing.ownerUserId && incoming.ownerUserId && existing.ownerUserId !== incoming.ownerUserId
        if (!isInternalConfig && !isDifferentUser) {
          // User has a manually configured email that is not internal-imap — preserve it
          return { ok: true, skipped: true }
        }
        if (isInternalConfig && isSameUser) {
          // Same user, same internal config — update password/credentials but keep config
          await emailService.saveConfig(incoming)
          return { ok: true }
        }
      }
      await emailService.saveConfig(incoming)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /* ---- Workspace Activity / Daily Report ---- */

  // Helper: read session user info without logging token
  async function getActivityUserContext(): Promise<{
    userId: string; username: string; tokenValid: boolean
  }> {
    try {
      const sessionPath = path.join(app.getPath('userData'), 'internal-account-session.json')
      const raw = await fs.readFile(sessionPath, 'utf-8')
      const data = JSON.parse(raw) as { user?: { id?: string; username?: string } }
      const u = data.user
      if (u?.id && u?.username) return { userId: u.id, username: u.username, tokenValid: true }
    } catch { /* no session */ }
    return { userId: 'unknown', username: 'unknown', tokenValid: false }
  }

  function workspaceIdFromPath(p: string): string {
    const { createHash } = require('node:crypto') as typeof import('node:crypto')
    return createHash('sha256').update(p).digest('hex').slice(0, 16)
  }

  function dateKey(d?: string): string {
    return d ?? new Date().toISOString().slice(0, 10)
  }

  ipcMain.handle('activity:takeSnapshot', async (_, payload: unknown) => {
    try {
      const { workspacePath } = (payload || {}) as { workspacePath?: string }
      if (!workspacePath) return { ok: false, error: '缺少 workspacePath' }
      const snapshot = await workspaceActivity.takeSnapshot(workspacePath)
      // Track last active workspace for quit-time auto-snapshot
      _lastActiveWorkspacePath = workspacePath
      // Enqueue for server upload (fire-and-forget)
      void (async () => {
        try {
          const { userId, username } = await getActivityUserContext()
          const { randomUUID } = await import('node:crypto')
          await activitySync.enqueue('snapshot', {
            id: randomUUID(),
            userId,
            username,
            workspaceId: workspaceIdFromPath(workspacePath),
            workspaceName: path.basename(workspacePath),
            dateKey: snapshot.date,
            snapshotType: 'manual',
            fileCount: snapshot.files.length,
            totalBytes: snapshot.files.reduce((s, f) => s + (f.size ?? 0), 0),
            createdAt: snapshot.createdAt,
            files: snapshot.files.map((f) => ({
              pathHash: workspaceIdFromPath(f.path),
              relativePath: f.relativePath || path.relative(workspacePath, f.path),
              fileName: path.basename(f.path),
              fileType: path.extname(f.path),
              size: f.size ?? 0,
              modifiedAt: f.modifiedAt,
              contentHash: f.hash,
            })),
          })
        } catch { /* queue errors must not break user */ }
      })()
      return { ok: true, snapshot }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:getActivity', async (_, payload: unknown) => {
    try {
      const { workspacePath, date, baseDate } = (payload || {}) as {
        workspacePath?: string; date?: string; baseDate?: string
      }
      if (!workspacePath) return { ok: false, error: '缺少 workspacePath' }
      const diff = await workspaceActivity.getFileDiff(workspacePath, date, baseDate)
      // Enqueue diff
      void (async () => {
        try {
          const { userId, username } = await getActivityUserContext()
          const { randomUUID } = await import('node:crypto')
          await activitySync.enqueue('diff', {
            id: randomUUID(),
            userId,
            username,
            workspaceId: workspaceIdFromPath(workspacePath),
            workspaceName: path.basename(workspacePath),
            dateKey: dateKey(date),
            baseDateKey: diff.baseDate,
            createdFiles: diff.created.map((f) => ({ ...f, relativePath: f.relativePath || path.relative(workspacePath, f.path) })),
            modifiedFiles: diff.modified.map((f) => ({ ...f, relativePath: f.relativePath || path.relative(workspacePath, f.path) })),
            deletedFiles: diff.deleted.map((f) => ({ ...f, relativePath: f.relativePath || path.relative(workspacePath, f.path) })),
            exportedFiles: diff.exported.map((f) => ({ ...f, relativePath: f.relativePath || path.relative(workspacePath, f.path) })),
            createdAt: new Date().toISOString(),
          })
        } catch { /* queue errors must not break user */ }
      })()
      return { ok: true, diff }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:analyzeFiles', async (_, payload: unknown) => {
    try {
      const { workspacePath, date } = (payload || {}) as { workspacePath?: string; date?: string }
      if (!workspacePath) return { ok: false, error: '缺少 workspacePath' }
      const settings = await store.resolveEffectiveSettings()
      const summaries = await workspaceActivity.analyzeChangedFiles(workspacePath, settings, date)
      // Enqueue file summaries
      void (async () => {
        try {
          const { userId, username } = await getActivityUserContext()
          const { randomUUID } = await import('node:crypto')
          for (const s of summaries) {
            await activitySync.enqueue('file_summary', {
              id: randomUUID(),
              userId,
              username,
              workspaceId: workspaceIdFromPath(workspacePath),
              dateKey: dateKey(date),
              fileId: workspaceIdFromPath(s.filePath),
              fileName: s.fileName,
              fileType: path.extname(s.filePath),
              changeType: s.changeType,
              workType: s.workType,
              topic: s.topic,
              summary: s.summary,
              keyActions: s.keyActions,
              outputValue: s.outputValue,
              confidence: s.confidence,
              createdAt: new Date().toISOString(),
            })
          }
        } catch { /* queue errors must not break user */ }
      })()
      return { ok: true, summaries }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:generateReport', async (_, payload: unknown) => {
    try {
      const { workspacePath, date, username } = (payload || {}) as {
        workspacePath?: string; date?: string; username?: string
      }
      if (!workspacePath) return { ok: false, error: '缺少 workspacePath' }
      const settings = await store.resolveEffectiveSettings()
      const report = await workspaceActivity.generateDailyReport(workspacePath, settings, date, username)
      // Enqueue daily report
      void (async () => {
        try {
          const { userId, username: uname } = await getActivityUserContext()
          const { randomUUID } = await import('node:crypto')
          await activitySync.enqueue('daily_report', {
            id: randomUUID(),
            userId,
            username: username ?? uname,
            workspaceId: workspaceIdFromPath(workspacePath),
            dateKey: dateKey(date),
            reportType: 'user_daily',
            summaryText: report.overview,
            structuredJson: {
              overview: report.overview,
              mainWork: report.mainWork,
              keyOutputs: report.keyOutputs,
              yesterdayComparison: report.comparison,
              errors: report.anomalies,
              tomorrowSuggestions: report.suggestions,
            },
            generatedByModel: 'local-llm',
            generatedAt: report.generatedAt,
          })
        } catch { /* queue errors must not break user */ }
      })()
      return { ok: true, report }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:getReport', async (_, payload: unknown) => {
    try {
      const { workspacePath, date } = (payload || {}) as { workspacePath?: string; date?: string }
      if (!workspacePath) return { ok: false, error: '缺少 workspacePath' }
      const report = await workspaceActivity.readReport(workspacePath, date)
      return { ok: true, report }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:syncStatus', async () => {
    try {
      const status = await activitySync.getStatus()
      return { ok: true, status }
    } catch {
      return { ok: true, status: { lastSyncAt: null, lastSyncError: null, pendingCount: 0 } }
    }
  })

  ipcMain.handle('activity:flushSync', async () => {
    try {
      const result = await activitySync.flush()
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Fetch admin activity data from server (admin only — client checks role)
  ipcMain.handle('activity:adminFetch', async (_, payload: unknown) => {
    try {
      const { endpoint } = (payload || {}) as { endpoint?: string }
      if (!endpoint) return { ok: false, error: 'missing endpoint' }
      const tokenPath = path.join(app.getPath('userData'), 'internal-account-token.json')
      let token: string | null = null
      try {
        const raw = await fs.readFile(tokenPath, 'utf-8')
        token = (JSON.parse(raw) as { token?: string }).token ?? null
      } catch { /* ignore */ }
      if (!token) return { ok: false, error: '未登录内部账号' }
      const resp = await fetch(`http://10.20.5.61:13100${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await resp.json()
      return { ok: resp.ok, data, httpStatus: resp.status }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Post admin commands to server (e.g. trigger report generation)
  ipcMain.handle('activity:adminPost', async (_, payload: unknown) => {
    try {
      const { endpoint, body } = (payload || {}) as { endpoint?: string; body?: Record<string, unknown> }
      if (!endpoint) return { ok: false, error: 'missing endpoint' }
      const tokenPath = path.join(app.getPath('userData'), 'internal-account-token.json')
      let token: string | null = null
      try {
        const raw = await fs.readFile(tokenPath, 'utf-8')
        token = (JSON.parse(raw) as { token?: string }).token ?? null
      } catch { /* ignore */ }
      if (!token) return { ok: false, error: '未登录内部账号' }
      const resp = await fetch(`http://10.20.5.61:13100${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body ?? {}),
      })
      const data = await resp.json()
      return { ok: resp.ok, data, httpStatus: resp.status }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── User Action Log IPC handlers ───────────────────────────────────────────
  //
  // Persists per-user work activity entries to disk under:
  //   {userData}/user-action-logs/{userId}/{YYYY-MM-DD}.json
  //
  // This makes activity records available to any logged-in user (e.g. a
  // manager generating a daily report for a subordinate) without requiring
  // the subordinate to be online.  Files older than 3 days are pruned
  // automatically.

  ipcMain.handle('activity:logUserAction', async (_, payload: unknown) => {
    try {
      const p = (payload || {}) as Record<string, unknown>
      const {
        userId, module: mod, action, title, summary, workspaceId, metadata, createdAt,
        eventType, sessionId, startedAt, endedAt, durationMs, status,
        targetType, targetId, targetTitle, details, errorCode, errorMessage,
        localId,
      } = p as {
        userId?: string; module?: string; action?: string; title?: string
        summary?: string; workspaceId?: string; metadata?: unknown; createdAt?: string
        eventType?: string; sessionId?: string; startedAt?: string; endedAt?: string
        durationMs?: number; status?: string; targetType?: string; targetId?: string
        targetTitle?: string; details?: Record<string, unknown>; errorCode?: string
        errorMessage?: string; localId?: string
      }
      if (!userId || !mod || !action) return { ok: false, error: 'missing userId/module/action' }

      const entryTime = createdAt ? new Date(createdAt) : new Date()
      const dateKey = `${entryTime.getFullYear()}-${String(entryTime.getMonth() + 1).padStart(2, '0')}-${String(entryTime.getDate()).padStart(2, '0')}`

      const logDir = path.join(app.getPath('userData'), 'user-action-logs', userId)
      await fs.mkdir(logDir, { recursive: true })
      const logFile = path.join(logDir, `${dateKey}.json`)

      let entries: unknown[] = []
      try {
        const raw = await fs.readFile(logFile, 'utf-8')
        entries = JSON.parse(raw) as unknown[]
        if (!Array.isArray(entries)) entries = []
      } catch { /* file doesn't exist yet */ }

      const { randomUUID } = await import('node:crypto')
      entries.push({
        id: randomUUID(),
        localId: String(localId ?? randomUUID()),
        userId,
        module: mod,
        action,
        title,
        summary,
        workspaceId,
        metadata,
        createdAt: entryTime.toISOString(),
        syncStatus: 'pending',
        // New structured fields (present when caller provides them)
        eventType: eventType ?? action,
        sessionId,
        startedAt,
        endedAt,
        durationMs,
        status: status ?? 'success',
        targetType,
        targetId,
        targetTitle,
        details: details ?? (metadata as Record<string, unknown> | undefined),
        errorCode,
        errorMessage,
      })
      await fs.writeFile(logFile, JSON.stringify(entries, null, 2), 'utf-8')

      // Also forward to in-process userActionLogService so it can build DailyReportInput
      try {
        userActionLogService.appendAction({
          module: mod,
          action,
          eventType: eventType ?? action,
          title,
          summary,
          startedAt,
          endedAt,
          durationMs,
          status: (status as 'success' | 'failed' | 'cancelled' | undefined) ?? 'success',
          targetType,
          targetId,
          targetTitle,
          details: details ?? (metadata as Record<string, unknown> | undefined),
          errorCode,
          errorMessage,
        })
      } catch { /* never crash main logic */ }

      // Prune files older than 3 days (fire-and-forget)
      void (async () => {
        try {
          const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000
          const files = await fs.readdir(logDir).catch(() => [] as string[])
          for (const f of files) {
            if (!f.endsWith('.json')) continue
            const fileStat = await fs.stat(path.join(logDir, f)).catch(() => null)
            if (fileStat && fileStat.mtimeMs < cutoff) {
              await fs.unlink(path.join(logDir, f)).catch(() => { /* ignore */ })
            }
          }
        } catch { /* prune errors must never break the user */ }
      })()

      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:setIdentity', async (_, payload: unknown) => {
    try {
      const { userId, username } = (payload || {}) as { userId?: string; username?: string }
      if (!userId) return { ok: false, error: 'missing userId' }

      // If switching to a different user, flush + upload the previous user's pending logs
      // while we still have their token, before overwriting identity.
      const { userId: prevUserId } = userActionLogService.getSyncStatus()
      if (prevUserId && prevUserId !== userId) {
        try {
          await userActionLogService.flush()
          void delegationService.uploadActivityLogs().catch(() => undefined)
        } catch { /* best-effort — never block identity switch */ }
      }

      userActionLogService.setIdentity(userId, username)

      // After login, upload any pending logs for this user with a short delay
      setTimeout(() => void delegationService.uploadActivityLogs().catch(() => undefined), 5_000)

      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('activity:getUserActions', async (_, payload: unknown) => {
    try {
      const { userId, date } = (payload || {}) as { userId?: string; date?: string }
      if (!userId || !date) return { ok: false, error: 'missing userId or date', actions: [] }

      const logFile = path.join(app.getPath('userData'), 'user-action-logs', userId, `${date}.json`)
      let actions: unknown[] = []
      try {
        const raw = await fs.readFile(logFile, 'utf-8')
        actions = JSON.parse(raw) as unknown[]
        if (!Array.isArray(actions)) actions = []
      } catch { /* file doesn't exist — user has no activity for that day */ }

      console.log('[daily-report-activity-query]', {
        userId,
        date,
        logFile,
        activityCount: actions.length,
      })

      return { ok: true, actions }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), actions: [] }
    }
  })

  // ── AI Delegation / 下班托管 IPC handlers ─────────────────────────────────

  ipcMain.handle('delegation:enable', async (_, payload: unknown) => {
    try {
      const { userId, workspacePath, policyId } = (payload || {}) as {
        userId?: string; workspacePath?: string; policyId?: string
      }
      if (!userId) return { ok: false, error: 'missing userId' }
      const settings = await getEffectiveSettings()
      const { delegationService } = await import('./services/delegationService')
      const state = await delegationService.enableDelegation(userId, settings, policyId)
      return { ok: true, state }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:disable', async (_, payload: unknown) => {
    try {
      const { userId } = (payload || {}) as { userId?: string }
      if (!userId) return { ok: false, error: 'missing userId' }
      const settings = await getEffectiveSettings()
      const { delegationService } = await import('./services/delegationService')
      const state = await delegationService.disableDelegation(userId, settings)
      return { ok: true, state }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:getStatus', async () => {
    try {
      const { delegationService } = await import('./services/delegationService')
      const state = await delegationService.getState()
      return { ok: true, state }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:getAuditLog', async () => {
    try {
      const { delegationService } = await import('./services/delegationService')
      const events = await delegationService.getAuditLog()
      return { ok: true, events }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:getPendingReplies', async () => {
    try {
      const { delegationService } = await import('./services/delegationService')
      const replies = await delegationService.getPendingReplies()
      return { ok: true, replies }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:reviewReply', async (_, payload: unknown) => {
    try {
      const { replyId, action, reviewerUserId } = (payload || {}) as {
        replyId?: string; action?: 'approve' | 'reject'; reviewerUserId?: string
      }
      if (!replyId || !action || !reviewerUserId) return { ok: false, error: 'missing fields' }
      const { delegationService } = await import('./services/delegationService')
      const newStatus = action === 'approve' ? 'approved' : 'rejected'
      await delegationService.updatePendingReplyStatus(replyId, newStatus, reviewerUserId)
      const auditAction = action === 'approve' ? 'auto_reply_approved' : 'auto_reply_rejected'
      await delegationService.appendAuditEvent({
        action: auditAction,
        actorId: reviewerUserId,
        actorUsername: reviewerUserId,
        entityId: replyId,
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:uploadWorkReport', async (_, payload: unknown) => {
    try {
      const { delegationService } = await import('./services/delegationService')
      const settings = await getEffectiveSettings()
      const reportId = await delegationService.saveWorkReportData(payload as any, settings)
      return { ok: true, reportId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delegation:generateAutoReply', async (_, payload: unknown) => {
    try {
      const { autoReplyService } = await import('./services/autoReplyService')
      const settings = await getEffectiveSettings()
      const { result, pendingReply } = await autoReplyService.generateReply(
        payload as any,
        settings,
      )
      return { ok: true, result, pendingReply }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Flush on startup, then every 30 seconds
  void activitySync.flush().catch(() => {})
  const syncInterval = setInterval(() => { void activitySync.flush().catch(() => {}) }, 30_000)
  const uploadInterval = setInterval(() => { void delegationService.uploadActivityLogs().catch(() => {}) }, 2 * 60 * 1000)
  app.on('before-quit', () => { clearInterval(syncInterval); clearInterval(uploadInterval) })
  ipcMain.handle('file:copyToPath', async (_, sourcePath, targetPath) => {
    const source = path.resolve(String(sourcePath || '').trim())
    const target = path.resolve(String(targetPath || '').trim())
    if (!source || !target) {
      throw new Error('源路径和目标路径不能为空')
    }
    if (source === target) {
      return { success: true, path: target }
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(source, target)
    return { success: true, path: target }
  })
  ipcMain.handle('file:write', async (_, filePath, content) => {
    const target = String(filePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, String(content), 'utf-8')
    return { success: true, filePath: target }
  })
  ipcMain.handle('file:writeDocx', async (_, filePath, markdown) => {
    const target = String(filePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const rewritten = await documentEngineService.writeOoxmlPackage(target, { html: String(markdown) })
    if (rewritten.success) {
      return { success: true, filePath: target }
    }
    await exportDocxToPath(String(markdown), target)
    return { success: true, filePath: target }
  })

  ipcMain.handle('file:exportWithJournalFormat', async (_, payload: { html: string; config: { presetId: string; runningTitle: string; authorLine: string } }) => {
    const { getJournalPreset } = await import('../../src/utils/journalExportPresets')
    const preset = getJournalPreset(payload.config.presetId)
    if (!preset) return { success: false, filePath: null, error: `未知期刊预设: ${payload.config.presetId}` }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '期刊格式导出',
      defaultPath: `投稿稿件_${preset.label}.docx`,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    })
    if (canceled || !filePath) return { success: false, filePath: null }

    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    await exportWithJournalFormat(payload.html, filePath, {
      preset,
      runningTitle: payload.config.runningTitle,
      authorLine: payload.config.authorLine,
    })
    try {
      const fileName = path.basename(filePath)
      userActionLogService.appendAction({
        module: 'workspace',
        action: 'exportWithJournalFormat',
        eventType: 'file_exported',
        targetType: 'docx',
        targetTitle: fileName,
        startedAt,
        durationMs: Date.now() - t0,
        status: 'success',
        details: { fileName, fileType: 'docx', pathHash: createPathHash(filePath), operation: 'export', sourceModule: 'journalExporter' },
      })
    } catch { /* never crash main logic */ }
    return { success: true, filePath }
  })

  ipcMain.handle('pptx:generate', async (_, payload) => {
    const input = (payload || {}) as PptxGenerateInput
    console.log('[pptx:generate] templateId=', input.templateId ?? '(none)')
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    const result = await generatePptx(input)
    try {
      const inputAny = input as unknown as Record<string, unknown>
      const title = String(inputAny.title ?? inputAny.topic ?? '')
      const outputFileName = String((result as unknown as Record<string, unknown>)?.fileName ?? (result as unknown as Record<string, unknown>)?.outputPath ?? '')
      const slideCount = Number((result as unknown as Record<string, unknown>)?.slideCount ?? 0)
      const promptSummary = String(inputAny.userPrompt ?? inputAny.prompt ?? '').slice(0, 200)
      userActionLogService.appendAction({
        module: 'pptx',
        action: 'generate',
        eventType: 'ppt_generated',
        targetType: 'pptx',
        targetTitle: title || outputFileName,
        startedAt,
        durationMs: Date.now() - t0,
        status: 'success',
        details: { title, slideCount, promptSummary, outputFileName },
      })
    } catch { /* never crash main logic */ }
    return result
  })

  /* ---- PPT Content Package IPC (no LLM, no image API) ---- */

  ipcMain.handle('pptx:saveContentPackage', async (_, payload) => {
    const { workspacePath, pkg } = (payload || {}) as { workspacePath: string; pkg: Parameters<typeof saveContentPackage>[1] }
    if (!workspacePath || !pkg) return { success: false, error: '参数不完整' }
    try {
      const result = await saveContentPackage(workspacePath, pkg)
      userActionLogService.appendAction({
        module: 'pptxGenerator',
        action: 'generate_content_package',
        eventType: 'generate_content_package',
        status: 'success',
        details: { packageId: result.packageId, title: pkg.title, llmCalls: 0, imageCalls: 0, tokenCost: 0 },
      })
      return { success: true, packageId: result.packageId, filePath: result.filePath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '保存内容包失败' }
    }
  })

  ipcMain.handle('pptx:loadContentPackage', async (_, payload) => {
    const { workspacePath, packageId } = (payload || {}) as { workspacePath: string; packageId: string }
    if (!workspacePath || !packageId) return { success: false, error: '参数不完整' }
    try {
      const pkg = await loadContentPackage(workspacePath, packageId)
      return pkg ? { success: true, pkg } : { success: false, error: '内容包不存在' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取内容包失败' }
    }
  })

  ipcMain.handle('pptx:listContentPackages', async (_, payload) => {
    const { workspacePath } = (payload || {}) as { workspacePath: string }
    if (!workspacePath) return { success: false, packages: [], error: '参数不完整' }
    try {
      const packages = await listContentPackages(workspacePath)
      return { success: true, packages }
    } catch (error) {
      return { success: false, packages: [], error: error instanceof Error ? error.message : '列出内容包失败' }
    }
  })

  ipcMain.handle('pptx:renderWithSkill', async (_, payload) => {
    const { workspacePath, contentPackageId, skillId, outputPath } = (payload || {}) as {
      workspacePath: string
      contentPackageId: string
      skillId: string
      outputPath?: string
    }
    if (!workspacePath || !contentPackageId || !skillId) return { success: false, error: '参数不完整' }
    const t0 = Date.now()
    try {
      const artifact = await renderPptxWithSkill({ workspacePath, contentPackageId, skillId, outputPath })
      const durationMs = Date.now() - t0
      userActionLogService.appendAction({
        module: 'pptxGenerator',
        action: 'apply_skill',
        eventType: 'apply_skill',
        status: artifact.error ? 'failed' : 'success',
        durationMs,
        details: {
          contentPackageId,
          skillId,
          outputPath: artifact.outputPath,
          slideCount: artifact.slideCount,
          durationMs,
          llmCalls: 0,
          imageCalls: 0,
          tokenCost: 0,
        },
      })
      if (artifact.error) return { success: false, error: artifact.error }
      return { success: true, ...artifact }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '渲染 PPT 失败' }
    }
  })

  ipcMain.handle('pptx:listSkills', async (_, payload) => {
    const workspacePath = typeof (payload as { workspacePath?: unknown } | null)?.workspacePath === 'string'
      ? String((payload as { workspacePath: string }).workspacePath)
      : undefined
    return { success: true, skills: listPptSkills(workspacePath) }
  })

  ipcMain.handle('pptx:importFromDialog', async (_, payload) => {
    const workspacePath = typeof (payload as { workspacePath?: unknown } | null)?.workspacePath === 'string'
      ? String((payload as { workspacePath: string }).workspacePath)
      : ''
    if (!workspacePath) return { success: false, error: '未选择工作区。', previewSlides: [], extractionWarnings: [] }
    try {
      const selected = await dialog.showOpenDialog({
        title: '导入 PPT 内容',
        properties: ['openFile'],
        filters: [
          { name: 'PowerPoint 文件 (.pptx)', extensions: ['pptx'] },
        ],
      })
      if (selected.canceled || !selected.filePaths[0]) {
        return { success: false, canceled: true, previewSlides: [], extractionWarnings: [] }
      }
      const sourceFile = selected.filePaths[0]
      const importDir = path.join(workspacePath, '05_Presentation', 'imports')
      await fs.mkdir(importDir, { recursive: true })
      const stem = path.basename(sourceFile, path.extname(sourceFile))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'imported'
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const destFile = path.join(importDir, `${timestamp}_${stem}.pptx`)
      await fs.copyFile(sourceFile, destFile)
      const settings = await getEffectiveSettings()
      return await importPptxFromFile({
        workspacePath,
        pptxPath: destFile,
        source: { type: 'local_file', filename: path.basename(sourceFile) },
        importMode: 'rule_based',
      }, settings)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '导入 PPT 失败。', previewSlides: [], extractionWarnings: [] }
    }
  })

  // ---- DeckDocument IPC (Phase 1 — no LLM, no token cost) ----

  ipcMain.handle('deck:save', async (_, payload) => {
    const p = payload as { workspacePath: string; deck: unknown }
    try {
      const result = await saveDeckDocument(String(p.workspacePath || ''), p.deck as any)
      return result
    } catch (err) {
      return { success: false, deckId: '', filePath: '', error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('deck:load', async (_, payload) => {
    const p = payload as { workspacePath: string; deckId: string }
    return loadDeckDocument(String(p.workspacePath || ''), String(p.deckId || ''))
  })

  ipcMain.handle('deck:render', async (_, payload) => {
    const p = payload as { workspacePath: string; deckId: string; manifestId: string; outputPath?: string }
    return renderDeckDocument({
      workspacePath: String(p.workspacePath || ''),
      deckId: String(p.deckId || ''),
      manifestId: String(p.manifestId || ''),
      outputPath: p.outputPath ? String(p.outputPath) : undefined,
    })
  })

  ipcMain.handle('deck:updateSlide', async (_, payload) => {
    try {
      const p = payload as { workspacePath: string; deckId: string; slideIndex: number; updates: unknown }
      return await updateDeckSlide({
        workspacePath: String(p.workspacePath || ''),
        deckId: String(p.deckId || ''),
        slideIndex: Number(p.slideIndex),
        updates: p.updates,
      })
    } catch (err) {
      return { success: false, deckId: '', filePath: '', error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('deck:updateDeckDocument', async (_, payload) => {
    try {
      const p = payload as { workspacePath: string; deckId: string; updates: unknown }
      return await updateDeckDocument({
        workspacePath: String(p.workspacePath || ''),
        deckId: String(p.deckId || ''),
        updates: p.updates,
      })
    } catch (err) {
      return { success: false, deckId: '', filePath: '', error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('deck:optimizeStructure', async (_, payload) => {
    try {
      const p = payload as { workspacePath: string; deckId: string }
      const workspacePath = String(p.workspacePath || '')
      const deckId = String(p.deckId || '')
      if (!workspacePath || !deckId) {
        return { success: false, deckId, error: '请先生成或导入 PPT 内容后再优化结构。' }
      }
      const settings = await getEffectiveSettings()
      return await optimizeDeckStructure({ settings, workspacePath, deckId })
    } catch (err) {
      const p = payload as { deckId?: string } | null
      return { success: false, deckId: String(p?.deckId || ''), error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- DeckDocument Builder IPC (LLM-powered — costs tokens for build, not for render) ----

  ipcMain.handle('deck:buildFromPrompt', async (_, payload) => {
    const p = payload as Record<string, unknown>
    const taskId = typeof p.taskId === 'string' ? p.taskId : undefined
    const controller = new AbortController()
    if (taskId) pptTaskControllers.set(taskId, controller)
    try {
      const settings = await getEffectiveSettings()
      return await buildDeckFromPromptService(settings, payload, controller.signal)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isAborted = controller.signal.aborted || /aborted|cancelled/i.test(msg)
      return { success: false, warnings: [], error: isAborted ? '已停止' : msg }
    } finally {
      if (taskId) pptTaskControllers.delete(taskId)
    }
  })

  ipcMain.handle('deck:buildFromManuscript', async (_, payload) => {
    const p = payload as Record<string, unknown>
    const taskId = typeof p.taskId === 'string' ? p.taskId : undefined
    const controller = new AbortController()
    if (taskId) pptTaskControllers.set(taskId, controller)
    try {
      const settings = await getEffectiveSettings()
      return await buildDeckFromManuscriptService(settings, payload, controller.signal)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isAborted = controller.signal.aborted || /aborted|cancelled/i.test(msg)
      return { success: false, warnings: [], error: isAborted ? '已停止' : msg }
    } finally {
      if (taskId) pptTaskControllers.delete(taskId)
    }
  })

  ipcMain.handle('deck:buildFromImportedPptx', async (_, payload) => {
    try {
      const settings = await getEffectiveSettings()
      return await buildDeckFromImportedPptxService(settings, payload)
    } catch (err) {
      return { success: false, warnings: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('deck:extractPptx', async (_, payload) => {
    try {
      const p = payload as { pptxPath: string }
      return await extractRawPptxSlides(String(p.pptxPath || ''))
    } catch (err) {
      return { success: false, slides: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('deck:preview', async (_, payload) => {
    try {
      const p = payload as { pptxPath: string; previewDir: string }
      if (!p.pptxPath || !p.previewDir) {
        return { success: false, error: 'pptxPath and previewDir are required' }
      }
      return await renderPptxPreview({ pptxPath: p.pptxPath, previewDir: p.previewDir })
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pptx:importFromFile', async (_, payload) => {
    try {
      const settings = await getEffectiveSettings()
      return await importPptxFromFile(payload, settings)
    } catch (err) {
      return {
        success: false,
        previewSlides: [],
        extractionWarnings: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('ai:continueWriting', async (_, params) => {
    const settings = await getEffectiveSettings()
    emitAiEvent({ scope: 'continue', type: 'start' })
    const text = await continueWriting(settings, params, (chunk) => {
      emitAiEvent({ scope: 'continue', type: 'chunk', chunk })
    })
    emitAiEvent({ scope: 'continue', type: 'done', text })
    return text
  })

  ipcMain.handle('ai:rewriteParagraph', async (_, params) => {
    const settings = await getEffectiveSettings()
    emitAiEvent({ scope: 'rewrite', type: 'start' })
    const text = await rewriteParagraph(settings, params, (chunk) => {
      emitAiEvent({ scope: 'rewrite', type: 'chunk', chunk })
    })
    emitAiEvent({ scope: 'rewrite', type: 'done', text })
    return text
  })

  ipcMain.handle('ai:writingAssistant', async (_, params) => {
    const p = params as Record<string, unknown>
    const taskId = typeof p.taskId === 'string' ? p.taskId : undefined
    const settings = await getEffectiveSettings()
    const controller = new AbortController()
    if (taskId) pptTaskControllers.set(taskId, controller)
    emitAiEvent({ scope: 'assistant', type: 'start' })
    try {
      const text = await runWritingAssistant(settings, params as any, (chunk) => {
        emitAiEvent({ scope: 'assistant', type: 'chunk', chunk })
      }, (message) => {
        emitAiEvent({ scope: 'assistant', type: 'status', message })
      }, controller.signal)
      emitAiEvent({ scope: 'assistant', type: 'done', text })
      return text
    } finally {
      if (taskId) pptTaskControllers.delete(taskId)
    }
  })

  ipcMain.handle('ai:cancelTask', (_event, taskId: string) => {
    pptTaskControllers.get(taskId)?.abort()
    pptTaskControllers.delete(taskId)
  })

  ipcMain.handle('ai:generateOutline', async (_, params) => generateOutline(await getEffectiveSettings(), params))
  ipcMain.handle('ai:analyzeTopic', async (_, params) => analyzeTopic(await getEffectiveSettings(), params))
  ipcMain.handle('ai:generateExperimentPlan', async (_, params) => generateExperimentPlan(await getEffectiveSettings(), params))

  ipcMain.handle('ai:generateImage', async (_, params) => {
    const settings = await getEffectiveSettings()
    const outputDir = await resolveWorkspaceImageOutputDir((params as Record<string, unknown>)?.workspacePath)
    const traceId = (params as Record<string, unknown>)?.traceId || `img-ipc-${Date.now()}`
    console.info('[image:ipc-main]', JSON.stringify({
      traceId,
      handlerName: 'ai:generateImage',
      serviceName: 'ipcMain',
      rawUserPrompt: (params as Record<string, unknown>)?.prompt,
      referenceImageCount: Array.isArray((params as Record<string, unknown>)?.references)
        ? ((params as Record<string, unknown>).references as unknown[]).length
        : Array.isArray((params as Record<string, unknown>)?.referenceImages)
          ? ((params as Record<string, unknown>).referenceImages as unknown[]).length
          : 0,
      generationMode: (params as Record<string, unknown>)?.generationMode || 'style-continuation',
      styleOptions: (params as Record<string, unknown>)?.styleOptions || null,
      styleProfileSummary: ((params as Record<string, unknown>)?.styleProfile as Record<string, unknown> | undefined)?.summary || null,
      debugEnabled: Boolean(((params as Record<string, unknown>)?.debug as Record<string, unknown> | undefined)?.enabled),
      provider: settings.image.provider,
      model: settings.image.model,
      note: 'Received from preload IPC with structured reference payload — no prompt modification at this layer',
    }))
    emitAiEvent({ scope: 'image', type: 'progress', message: '正在启动图片生成' })
    const result = await generateImage(settings, outputDir, params, (message) => {
      emitAiEvent({ scope: 'image', type: 'progress', message })
    })
    emitAiEvent({ scope: 'image', type: 'done', result })
    return result
  })

  ipcMain.handle('ai:generatePaper', async (_, params) => {
    const settings = await getEffectiveSettings()
    const outputDir = await resolveWorkspaceImageOutputDir((params as Record<string, unknown>)?.workspacePath)
    const result = await generatePaper(settings, outputDir, params, (event) => {
      emitAiEvent({ scope: 'paper', type: 'progress', ...event })
      if (event.content || (Array.isArray(event.structuredBlocks) && event.structuredBlocks.length > 0) || event.cumulativeMarkdown) {
        emitAiEvent({
          scope: 'paper',
          type: 'content',
          step: event.step,
          content: event.content,
          contentType: event.contentType,
          cumulativeMarkdown: Array.isArray(event.structuredBlocks) && event.structuredBlocks.length > 0 ? undefined : event.cumulativeMarkdown,
          structuredBlocks: event.structuredBlocks,
          eventType: event.eventType,
          referenceAction: event.referenceAction,
          references: event.references,
          image: event.image,
          paragraphIndex: event.paragraphIndex,
          citationNumber: event.citationNumber,
          citation: event.citation,
          sentenceText: event.sentenceText,
          updatedParagraph: event.updatedParagraph,
        })
      }
    })
    emitAiEvent({ scope: 'paper', type: 'done', result })
    return result
  })

  ipcMain.handle('ai:organizeReferences', async (_, params) => {
    const settings = await getEffectiveSettings()
    const topic = String((params as any)?.topic || '').trim()
    const paperMarkdown = String((params as any)?.paperMarkdown || '').trim()
    const enableVerification = (params as any)?.enableVerification !== false
    const explicitReferences = Array.isArray((params as any)?.references) ? (params as any).references : null
    const references = explicitReferences ?? await searchReferencesWithNftcoreStrategy(settings, {
      topic,
      yearFrom: String((params as any)?.yearFrom || '').trim() || undefined,
      yearTo: String((params as any)?.yearTo || '').trim() || undefined,
      maxResults: settings.defaults.referenceCandidatePoolSize,
    })

    emitAiEvent({ scope: 'paper', type: 'progress', step: 25, message: '正在整理引用...', eventType: 'references', referenceAction: 'status' })
  const result = await organizeReferences(settings, {
    topic,
    paperMarkdown,
    references,
    enableVerification,
    analysisWindowSize: settings.defaults.referenceAnalysisWindow,
    targetReferenceCount: settings.defaults.referenceCount,
    referenceSoftFloorPercent: settings.defaults.referenceSoftFloorPercent,
  })
    emitAiEvent({ scope: 'paper', type: 'content', step: 25, content: result.updatedMarkdown, contentType: 'body', eventType: 'references', referenceAction: 'complete', references: result.referenceList })
    return {
      status: result.status,
      updated_markdown: result.updatedMarkdown,
      reference_list: result.referenceList,
      sentence_changes: result.sentenceChanges,
    }
  })

  ipcMain.handle('compat:submitTask', async (_, params) => {
    const settings = await getEffectiveSettings()
    const normalized = {
      ...params,
      withImages: params.noImageMode ? false : (params.withImages !== undefined ? params.withImages : true),
    }
    const scope = String((normalized as Record<string, unknown>)?.scope || '').trim()
    const taskId = scope === 'daily-report'
      ? await dailyReportTaskService.submitTask(settings, normalized)
      : scope === 'essay-writing'
        ? await essayTaskService.submitTask(settings, normalized)
        : await localTaskService.submitTask(settings, await resolveWorkspaceImageOutputDir((normalized as Record<string, unknown>)?.workspacePath), normalized)
    return {
      status: 'success',
      task_id: taskId,
      message: `任务已提交，ID: ${taskId}`,
    }
  })

  ipcMain.handle('compat:getTaskStatus', async (_, taskId) => {
    const normalizedTaskId = String(taskId)
    const task = essayTaskService.getTaskStatus(normalizedTaskId)
      || dailyReportTaskService.getTaskStatus(normalizedTaskId)
      || localTaskService.getTaskStatus(normalizedTaskId)
      || await (await getDefaultTaskService()).getTaskStatus(normalizedTaskId)
    if (!task) {
      return { status: 'failed', error: '任务不存在' }
    }
    return { status: 'success', task }
  })

  ipcMain.handle('compat:getTaskResult', async (_, taskId) => {
    const normalizedTaskId = String(taskId)
    const task = essayTaskService.getTaskStatus(normalizedTaskId)
      || dailyReportTaskService.getTaskStatus(normalizedTaskId)
      || localTaskService.getTaskStatus(normalizedTaskId)
      || await (await getDefaultTaskService()).getTaskStatus(normalizedTaskId)
    if (!task) {
      return { status: 'failed', error: '任务不存在' }
    }
    if (task.status !== 'completed') {
      return { status: 'pending', task_status: task.status, message: '任务尚未完成' }
    }
    const result = essayTaskService.getTaskResult(normalizedTaskId)
      || dailyReportTaskService.getTaskResult(normalizedTaskId)
      || localTaskService.getTaskResult(normalizedTaskId)
      || await (await getDefaultTaskService()).getTaskResult(normalizedTaskId)
    return { status: 'success', result }
  })

  ipcMain.handle('compat:getActiveTasks', async () => {
    const tasks = [...essayTaskService.getActiveTasks(), ...dailyReportTaskService.getActiveTasks(), ...localTaskService.getActiveTasks(), ...(await getDefaultTaskService()).getActiveTasks()]
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
    return {
      status: 'success',
      tasks,
    }
  })

  ipcMain.handle('compat:getRecentTasks', async (_, limit) => {
    const taskLimit = Number(limit) || 20
    const tasks = [...essayTaskService.getRecentTasks(taskLimit), ...dailyReportTaskService.getRecentTasks(taskLimit), ...localTaskService.getRecentTasks(taskLimit), ...await (await getDefaultTaskService()).getRecentTasks(taskLimit)]
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
      .slice(0, taskLimit)
    return {
      status: 'success',
      tasks,
    }
  })

  ipcMain.handle('compat:stopTask', async (_, taskId) => {
    const normalizedTaskId = String(taskId)
    const success = essayTaskService.stopTask(normalizedTaskId)
      || dailyReportTaskService.stopTask(normalizedTaskId)
      || localTaskService.stopTask(normalizedTaskId)
      || (await getDefaultTaskService()).stopTask(normalizedTaskId)
    return success ? { status: 'success' } : { status: 'failed', error: '任务不存在' }
  })

  ipcMain.handle('compat:pauseTask', async (_, taskId) => {
    const normalizedTaskId = String(taskId)
    const success = essayTaskService.pauseTask(normalizedTaskId)
      || dailyReportTaskService.pauseTask(normalizedTaskId)
      || localTaskService.pauseTask(normalizedTaskId)
      || (await getDefaultTaskService()).pauseTask(normalizedTaskId)
    return success ? { status: 'success' } : { status: 'failed', error: '任务不存在或当前状态不可暂停' }
  })

  ipcMain.handle('compat:resumeTask', async (_, taskId) => {
    const normalizedTaskId = String(taskId)
    const success = essayTaskService.resumeTask(normalizedTaskId)
      || dailyReportTaskService.resumeTask(normalizedTaskId)
      || localTaskService.resumeTask(normalizedTaskId)
      || (await getDefaultTaskService()).resumeTask(normalizedTaskId)
    return success ? { status: 'success' } : { status: 'failed', error: '任务不存在或当前状态不可继续' }
  })
  ipcMain.handle('compat:findCitationForText', async (_, params) => {
    const settings = await getEffectiveSettings()
    const topic = String(params?.topic || params?.selected_text || '').trim()
    const maxResults = Math.max(5, Math.min(100, Number(params?.max_results || 10)))
    const yearFrom = String(params?.yearFrom || params?.year_from || '').trim() || undefined
    const yearTo = String(params?.yearTo || params?.year_to || '').trim() || undefined
    const refs = await searchReferencesWithNftcoreStrategy(settings, { topic, maxResults, yearFrom, yearTo })
    return {
      status: 'success',
      citations: refs.map((item, index) => ({
        number: index + 1,
        citation: `${item.authors.slice(0, 3).join(', ') || 'Unknown'} (${item.year ?? 'n.d.'}). ${item.title}. ${item.journal}`.trim(),
        abstract: item.abstract,
        doi: item.doi || null,
      })),
    }
  })

  ipcMain.handle('ai:exportPdf', async (_, payload) => exportPdf(payload.markdown, payload.title))
  ipcMain.handle('ai:exportPdfFromEditor', async (event, payload) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    try {
      const result = await exportPdfFromEditorHtml(
        String(payload?.html || ''),
        payload?.styles ?? {},
        String(payload?.title || '文档'),
        parentWindow,
      )
      try {
        const filePath = String((result as unknown as Record<string, unknown>)?.filePath ?? '')
        const fileName = filePath ? path.basename(filePath) : String(payload?.title || '文档') + '.pdf'
        userActionLogService.appendAction({
          module: 'workspace',
          action: 'exportPdfFromEditor',
          eventType: 'file_exported',
          targetType: 'pdf',
          targetTitle: fileName,
          startedAt,
          durationMs: Date.now() - t0,
          status: 'success',
          details: { fileName, fileType: 'pdf', pathHash: filePath ? createPathHash(filePath) : '', operation: 'export', sourceModule: 'pdfExporter' },
        })
      } catch { /* never crash main logic */ }
      return result
    } catch (err) {
      console.error('[ai:exportPdfFromEditor]', err)
      try {
        userActionLogService.appendAction({
          module: 'workspace',
          action: 'exportPdfFromEditor',
          eventType: 'error_occurred',
          startedAt,
          durationMs: Date.now() - t0,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      } catch { /* never crash main logic */ }
      throw err
    }
  })
  ipcMain.handle('file:readGeneratedImage', async (_, filePath) => fs.readFile(filePath))

  // ---- Homework IPC ----
  ipcMain.handle('homework:extractQuestions', async (_event, payload) => {
    const settings = await getEffectiveSettings()
    const type = String(payload?.type || '')
    if (type === 'pdf') {
      const pageImages = Array.isArray(payload?.pageImages) ? payload.pageImages : []
      return extractQuestionsFromPdfImages(settings, pageImages, (current, total) => {
        safelySendToWindow(mainWindow, 'ai:event', {
          type: 'homework:extractProgress',
          current,
          total,
        })
      })
    }
    if (type === 'docx') {
      const filePath = String(payload?.filePath || '')
      const { questions } = await extractQuestionsFromDocx(settings, filePath)
      return questions
    }
    throw new Error(`Unknown homework extract type: ${type}`)
  })

  ipcMain.handle('homework:generateAnswer', async (_event, question) => {
    const settings = await getEffectiveSettings()
    const qn = String(question?.number || '')
    let accumulated = ''
    const answer = await homeworkGenerateAnswer(settings, question, (chunk) => {
      accumulated += chunk
      safelySendToWindow(mainWindow, 'ai:event', {
        type: 'homework:answerChunk',
        questionNumber: qn,
        chunk,
        accumulated,
      })
    })
    safelySendToWindow(mainWindow, 'ai:event', {
      type: 'homework:answerProgress',
      questionNumber: qn,
      status: 'done',
      accumulated: answer,
    })
    return answer
  })

  ipcMain.handle('homework:exportMarkdown', (_event, payload) => {
    const results = Array.isArray(payload?.results) ? payload.results : []
    const title = String(payload?.title || '')
    return homeworkExportToMarkdown(results, title)
  })

  // ── Skill Store ────────────────────────────────────────────────────────────
  ipcMain.handle('skill:openStore', async () => {    // Auto-start library (4010) + store (4030) if not already running.
    const platform = await ensureSkillPlatformRunning()
    if (!platform.ok) {
      return { ok: false, error: `Skill Store 启动失败：${platform.error}` }
    }

    const loginUrl = buildStoreLoginUrl(DEMO_ACCOUNT, DEMO_PASSWORD)
    let win: BrowserWindow | null = null
    try {
      win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Skill 商店',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      })

      await win.loadURL(loginUrl)
      return { ok: true }
    } catch (_err) {
      win?.close()
      return {
        ok: false,
        error: `Skill Store 打开失败，无法连接到 ${STORE_BASE}`,
      }
    }
  })

  ipcMain.handle('skill:getSyncPlan', async (_event, payload?: { userId?: string; deviceId?: string }) => {
    const userId = payload?.userId || 'user_001'
    const deviceId = payload?.deviceId || 'device_001'
    return getSkillSyncPlan(userId, deviceId)
  })

  ipcMain.handle('skill:listMySkins', async (_event, payload?: { userId?: string }) => {
    const userId = payload?.userId ?? 'user_001'
    return listMySkins(userId)
  })

  ipcMain.handle('skill:downloadPackage', async (_event, payload: { skillId: string; packageHash?: string; downloadPath?: string | null }) => {
    if (!payload?.skillId) return { ok: false, error: 'skillId 不能为空' }
    return downloadSkillPackage({ skillId: payload.skillId, packageHash: payload.packageHash })
  })

  ipcMain.handle('skill:getEmbedUrl', async () => {
    return getStoreEmbedUrl()
  })

  ipcMain.handle('skill:recognizePackage', async (_event, payload: { skillId: string; localPath: string }) => {
    if (!payload?.skillId || !payload?.localPath) return { ok: false, error: 'skillId 和 localPath 不能为空' }
    return recognizeSkillPackage(payload.skillId, payload.localPath, app.getPath('userData'))
  })

  ipcMain.handle('skill:listTemplates', async () => {
    const templates = listPptTemplates()
    return { ok: true, templates }
  })

  // Load skill-based PPT templates that were previously downloaded and recognized
  loadSkillTemplates(app.getPath('userData')).catch((err) => {
    console.warn('[skill-templates] loadSkillTemplates 失败:', err)
  })

  // Initialize built-in DeckDocument template manifests (Phase 1 + Phase 4 real PPTX skills).
  // Each template now points to its own source PPTX for visual differentiation via background injection.
  {
    // Phase 4: use per-template PPTX files under data/ppt-skills/
    const businessReportPath = buildPptSkillTemplatePath('business_report')
    const chineseSeasonPath  = buildPptSkillTemplatePath('chinese_season')
    const academicDefensePath = buildPptSkillTemplatePath('academic_defense')

    // Fallback to default template only if per-template PPTX is missing (e.g. first dev run)
    const defaultPath = resolveDefaultSourceTemplatePath()

    const fs_ = await import('node:fs')
    initBusinessReportLight(fs_.existsSync(businessReportPath) ? businessReportPath : defaultPath)
    initChineseSeasonLight(fs_.existsSync(chineseSeasonPath)   ? chineseSeasonPath  : defaultPath)
    initAcademicDefense(fs_.existsSync(academicDefensePath)    ? academicDefensePath : defaultPath)
    console.log('[deck-templates] Initialized academic_defense + business_report_light + chinese_season_light with per-template PPTX sources')
  }

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })

  app.on('before-quit', (event) => {
    stopSkillPlatform()
    void plotAgentService.stop()
    void userActionLogService.shutdown().catch(() => undefined)
    // Best-effort final upload of pending activity logs
    void delegationService.uploadActivityLogs().catch(() => undefined)
    if (_lastActiveWorkspacePath && !_quitSnapshotDone) {
      event.preventDefault()
      _quitSnapshotDone = true
      workspaceActivity.takeSnapshot(_lastActiveWorkspacePath)
        .catch(() => {/* ignore */})
        .finally(() => app.quit())
    }
  })
})

app.on('window-all-closed', () => {
  introductionRemakeWindow = null
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
