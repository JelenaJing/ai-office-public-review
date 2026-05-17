import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateImage } from '../electron/main/services/imageClient'
import { generatePaper } from '../electron/main/services/paperGenerator'
import { WorkspaceService } from '../electron/main/services/workspaceService'
import type { AppSettings } from '../electron/main/services/settingsStore'
import { hydrateQwenEnv, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL, QWEN_DEFAULT_PROVIDER } from './qwenDefaults'

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function loadSettings(rootDir: string): Promise<AppSettings> {
  const builtin = hydrateQwenEnv(rootDir)

  return {
    llm: {
      provider: QWEN_DEFAULT_PROVIDER,
      apiKey: String(builtin.qwenApiKey || '').trim(),
      useBuiltinKey: false,
      builtinKeyAvailable: true,
      model: QWEN_DEFAULT_MODEL,
      baseUrl: QWEN_DEFAULT_BASE_URL,
    },
    image: {
      provider: 'nanobanana',
      apiKey: String(builtin.nanobananaApiKey || '').trim(),
      useBuiltinKey: false,
      builtinKeyAvailable: true,
      model: 'nano-banana-pro',
      endpoint: 'https://grsai.dakka.com.cn/v1/draw/nano-banana',
    },
    defaults: {
      language: 'zh',
      paperType: 'review',
      noImageMode: false,
      yearFrom: '2021',
      yearTo: String(new Date().getFullYear()),
      extraContext: '',
      continueGoal: '保持学术风格自然续写',
      targetWords: 500,
      rewriteRequirements: '保持原意，增强学术表达与论证严谨性',
      referenceTopic: '',
      referenceYearFrom: '',
      referenceYearTo: '',
      referenceCount: 36,
      referenceCandidatePoolSize: 300,
      referenceAnalysisWindow: 40,
      livePreview: true,
      imageAspectRatio: '16:9',
    },
  }
}

async function main(): Promise<void> {
  const rootDir = process.cwd()
  const settings = await loadSettings(rootDir)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-image-check-'))
  const directOutputDir = path.join(tempRoot, 'direct-images')
  const workspaceRegistryDir = path.join(tempRoot, 'workspace-registry')
  const workspaceService = new WorkspaceService(workspaceRegistryDir)
  const workspace = await workspaceService.createWorkspace('image-check-workspace', tempRoot)
  const workspaceStructure = await workspaceService.detectProjectStructure(workspace.path)

  const generated = await generateImage(
    settings,
    directOutputDir,
    {
      prompt: process.env.AI_WRITER_IMAGE_TEST_PROMPT || '一张用于学术论文的多模态模型工作流程示意图，英文标注，简洁专业',
      aspectRatio: '16:9',
    },
    (message) => {
      console.log(`[progress] ${message}`)
    },
  )

  const directExists = await pathExists(generated.localPath)
  const savedToWorkspace = workspaceStructure.hasFigures
    ? await workspaceService.saveImageFromUrl(workspace.path, generated.localPath, path.basename(generated.localPath), true)
    : await workspaceService.saveImageFromUrl(workspace.path, generated.localPath, path.basename(generated.localPath), false)
  const workspaceExists = await pathExists(savedToWorkspace.path)

  const paperImageOutputDir = workspaceStructure.hasFigures
    ? path.join(workspace.path, '04_Figures_and_Tables', 'Final_Figures')
    : path.join(workspace.path, 'pic')
  const paperResult = await generatePaper(
    settings,
    paperImageOutputDir,
    {
      topic: process.env.AI_WRITER_PAPER_IMAGE_TEST_TOPIC || '多模态大模型在科研写作辅助中的图文协同方法',
      language: 'zh',
      paperType: 'review',
      yearFrom: '2022',
      yearTo: '2025',
      extraContext: '请至少生成一张用于论文正文的英文标注示意图，并在正文中插入对应图片。',
      withImages: true,
    },
    (event) => {
      if (event.eventType === 'image') {
        console.log(`[paper-image] step=${event.step} message=${event.message}`)
      }
    },
  )
  const paperImageCount = Array.isArray(paperResult.images) ? paperResult.images.length : 0
  const firstPaperImagePath = paperImageCount > 0 ? String(paperResult.images[0]?.path || '') : ''
  const firstPaperImageExists = firstPaperImagePath ? await pathExists(firstPaperImagePath) : false

  console.log('=== IMAGE CHECK SUMMARY ===')
  console.log(JSON.stringify({
    directOutputDir,
    directImageExists: directExists,
    directImagePath: generated.localPath,
    sourceUrlPresent: Boolean(String(generated.sourceUrl || '').trim()),
    workspacePath: workspace.path,
    workspaceHasFigures: workspaceStructure.hasFigures,
    workspaceImageExists: workspaceExists,
    workspaceImagePath: savedToWorkspace.path,
    paperImageCount,
    firstPaperImageExists,
    firstPaperImagePath,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})