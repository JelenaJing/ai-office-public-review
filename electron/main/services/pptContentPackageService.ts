/**
 * PPT Content Package Service — save / load / list / render.
 *
 * All operations here are pure local I/O + PptxGenJS rendering.
 * NO LLM calls, NO image generation API calls, ever.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { generatePptx } from './pptxGenerator'
import { resolvePptBrandTemplate, listPptTemplates, DEFAULT_PPT_TEMPLATE_ID } from './pptTemplateRegistry'
import type { PptBrandTemplate } from './pptTemplateRegistry'

/* ---------- Types (mirrored from src/types for main-process use) ---------- */

export interface PptContentAsset {
  slideIndex: number
  imagePath: string
}

export interface PresentationContentPackage {
  id: string
  schemaVersion: '1.0'
  kind: 'presentation'
  title: string
  sourcePrompt: string
  slides: Array<{
    type: string
    title?: string
    subtitle?: string
    heading?: string
    body?: string
    items?: string[]
    leftTitle?: string
    leftItems?: string[]
    rightTitle?: string
    rightItems?: string[]
    metrics?: Array<{ value: string; label: string; detail?: string }>
    timeline?: Array<{ title: string; detail?: string }>
    imagePath?: string
    notes?: string
  }>
  assets: PptContentAsset[]
  createdAt: string
  status: 'partial' | 'completed'
  expectedSlideCount: number
  completedSlideCount: number
  stoppedAt?: string
  activeSkillId?: string
  /** Full outline plan for all expected slides. Enables resume of partial generation. */
  outlinePlan?: Array<{ index: number; role: string; heading: string; hint?: string }>
}

export interface RenderedArtifact {
  contentPackageId: string
  skillId: string
  outputPath: string
  slideCount: number
  renderedAt: string
}

export interface PptSkillInfo {
  id: string
  name: string
  description: string
  previewColor: string
  category: 'presentation'
  requiresLLM: false
  source: 'built-in' | 'skill'
  widthInches?: number
  heightInches?: number
}

/* ---------- Path helpers ---------- */

function resolveContentPackageDir(workspacePath: string): string {
  return path.join(workspacePath, '05_Presentation', 'content-packages')
}

function resolveContentPackagePath(workspacePath: string, packageId: string): string {
  return path.join(resolveContentPackageDir(workspacePath), `${packageId}.ppt-content.json`)
}

/* ---------- Save ---------- */

export async function saveContentPackage(
  workspacePath: string,
  pkg: Omit<PresentationContentPackage, 'id' | 'createdAt' | 'schemaVersion' | 'kind'> & { id?: string; createdAt?: string },
): Promise<{ packageId: string; filePath: string }> {
  const packageId = pkg.id || randomUUID()
  const now = pkg.createdAt || new Date().toISOString()

  const finalPkg: PresentationContentPackage = {
    id: packageId,
    schemaVersion: '1.0',
    kind: 'presentation',
    title: pkg.title,
    sourcePrompt: pkg.sourcePrompt,
    slides: pkg.slides,
    assets: pkg.assets || [],
    createdAt: now,
    status: pkg.status ?? 'completed',
    expectedSlideCount: pkg.expectedSlideCount ?? pkg.slides.length,
    completedSlideCount: pkg.completedSlideCount ?? pkg.slides.length,
    stoppedAt: pkg.stoppedAt,
    activeSkillId: pkg.activeSkillId,
    outlinePlan: pkg.outlinePlan,
  }

  const dir = resolveContentPackageDir(workspacePath)
  await fs.mkdir(dir, { recursive: true })

  const filePath = resolveContentPackagePath(workspacePath, packageId)
  await fs.writeFile(filePath, JSON.stringify(finalPkg, null, 2), 'utf-8')

  return { packageId, filePath }
}

/* ---------- Load ---------- */

export async function loadContentPackage(
  workspacePath: string,
  packageId: string,
): Promise<PresentationContentPackage | null> {
  const filePath = resolveContentPackagePath(workspacePath, packageId)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as PresentationContentPackage
  } catch {
    return null
  }
}

/* ---------- List ---------- */

export async function listContentPackages(
  workspacePath: string,
): Promise<Array<{ packageId: string; title: string; createdAt: string; filePath: string }>> {
  const dir = resolveContentPackageDir(workspacePath)
  try {
    const entries = await fs.readdir(dir)
    const results: Array<{ packageId: string; title: string; createdAt: string; filePath: string }> = []

    for (const entry of entries) {
      if (!entry.endsWith('.ppt-content.json')) continue
      const filePath = path.join(dir, entry)
      try {
        const raw = await fs.readFile(filePath, 'utf-8')
        const pkg = JSON.parse(raw) as PresentationContentPackage
        results.push({
          packageId: pkg.id,
          title: pkg.title || entry,
          createdAt: pkg.createdAt,
          filePath,
        })
      } catch {
        // Skip corrupt files
      }
    }

    return results.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
  } catch {
    return []
  }
}

/* ---------- Render with Skill (NO LLM, NO image API) ---------- */

export async function renderWithSkill(options: {
  workspacePath: string
  contentPackageId: string
  skillId: string
  outputPath?: string
}): Promise<RenderedArtifact & { error?: string }> {
  const { workspacePath, contentPackageId, skillId, outputPath: customOutputPath } = options

  // Load content package
  const pkg = await loadContentPackage(workspacePath, contentPackageId)
  if (!pkg) {
    return {
      contentPackageId,
      skillId,
      outputPath: '',
      slideCount: 0,
      renderedAt: new Date().toISOString(),
      error: `内容包不存在：${contentPackageId}`,
    }
  }

  const template: PptBrandTemplate = resolvePptBrandTemplate(skillId)

  // Merge image assets from the package back onto slides
  const slidesWithImages = pkg.slides.map((slide, index) => {
    const asset = pkg.assets.find((a) => a.slideIndex === index)
    if (asset && !slide.imagePath) {
      return { ...slide, imagePath: asset.imagePath }
    }
    return slide
  })

  // Build output path
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeTitle = (pkg.title || '演示文稿').replace(/[/\\:*?"<>|]/g, '-').slice(0, 40)
  const outputDir = path.join(workspacePath, '05_Presentation')
  const fileName = `${safeTitle}_${skillId}_${timestamp}.pptx`
  const outputPath = customOutputPath || path.join(outputDir, fileName)

  const result = await generatePptx({
    plan: {
      title: pkg.title,
      slides: slidesWithImages as any,
    },
    outputPath,
    templateId: template.id,
  })

  if (!result.success) {
    return {
      contentPackageId,
      skillId,
      outputPath: '',
      slideCount: 0,
      renderedAt: new Date().toISOString(),
      error: result.error || 'PPTX 渲染失败',
    }
  }

  return {
    contentPackageId,
    skillId,
    outputPath: result.outputPath,
    slideCount: result.slideCount,
    renderedAt: new Date().toISOString(),
  }
}

/* ---------- List available skills ---------- */

export function listPptSkills(_workspacePath?: string | null): PptSkillInfo[] {
  return listPptTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || t.name,
    previewColor: t.previewColor || t.theme.primary,
    category: 'presentation' as const,
    requiresLLM: false as const,
    source: t.source,
    widthInches: t.slideSize.widthInches,
    heightInches: t.slideSize.heightInches,
  }))
}
