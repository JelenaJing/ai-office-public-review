import fs from 'node:fs'
import path from 'node:path'
import {
  registerTemplateManifest,
} from '../../../src/types/pptTemplateManifest'

export interface PptBrandTheme {
  primary: string
  secondary: string
  accent: string
  light: string
  bg: string
  text: string
  muted: string
}

export interface PptTemplateBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PptBrandTemplate {
  id: string
  name: string
  type: 'brand-master'
  source: 'built-in' | 'skill'
  slideSize: {
    cx: number
    cy: number
    widthInches: number
    heightInches: number
    layoutName: string
  }
  theme: PptBrandTheme
  margins: {
    top: number
    right: number
    bottom: number
    left: number
  }
  safeArea: {
    title: PptTemplateBox
    body: PptTemplateBox
    image: PptTemplateBox
  }
  assets: {
    sourceTemplatePath: string
    backgroundImagePath: string
    headerLogoPath: string
  }
  master: {
    name: string
    backgroundBox: PptTemplateBox
    headerLogoBox: PptTemplateBox
  }
}

export const DEFAULT_PPT_TEMPLATE_ID = 'cuhk_sz_default'

function resolveTemplateAssetsRoot(): string {
  const packagedRoot = path.join(String(process.resourcesPath || ''), 'data', 'ppt-templates')
  if (packagedRoot && fs.existsSync(packagedRoot)) {
    return packagedRoot
  }
  return path.resolve(process.cwd(), 'electron/main/data/ppt-templates')
}

function buildTemplateAssetPath(templateId: string, fileName: string): string {
  return path.join(resolveTemplateAssetsRoot(), templateId, fileName)
}

/** Exported helper used by DeckDocumentService to locate source template files. */
export function buildTemplateSourcePath(templateId: string, fileName: string): string {
  return buildTemplateAssetPath(templateId, fileName)
}

/**
 * Resolve the root directory for built-in PPT Skill templates.
 * In packaged app: resources/data/ppt-skills
 * In dev:          electron/main/data/ppt-skills
 */
export function resolvePptSkillsRoot(): string {
  const packaged = path.join(String(process.resourcesPath || ''), 'data', 'ppt-skills')
  if (packaged && fs.existsSync(packaged)) return packaged
  return path.resolve(process.cwd(), 'electron/main/data/ppt-skills')
}

/**
 * Resolve the source PPTX path for a named PPT Skill (e.g. 'academic_defense').
 * The skill directory must contain source-template.pptx.
 */
export function buildPptSkillTemplatePath(skillDirName: string): string {
  return path.join(resolvePptSkillsRoot(), skillDirName, 'source-template.pptx')
}

const CUHK_SZ_DEFAULT_TEMPLATE: PptBrandTemplate = {
  id: DEFAULT_PPT_TEMPLATE_ID,
  name: '港中文深圳默认模板',
  type: 'brand-master',
  source: 'built-in',
  slideSize: {
    cx: 12192000,
    cy: 6858000,
    widthInches: 13.333333,
    heightInches: 7.5,
    layoutName: 'CUHK_SZ_DEFAULT_LAYOUT',
  },
  theme: {
    primary: '6D2268',
    secondary: '2F2A28',
    accent: 'C9A227',
    light: 'EEE6D8',
    bg: 'FFFFFF',
    text: '2F2A28',
    muted: '6F625A',
  },
  margins: {
    top: 0.58,
    right: 0.82,
    bottom: 0.48,
    left: 0.86,
  },
  safeArea: {
    title: { x: 0.92, y: 0.82, w: 8.2, h: 0.56 },
    body: { x: 1.02, y: 1.62, w: 11.1, h: 4.95 },
    image: { x: 9.05, y: 1.82, w: 3.15, h: 3.95 },
  },
  assets: {
    sourceTemplatePath: buildTemplateAssetPath(DEFAULT_PPT_TEMPLATE_ID, 'source-template.pptx'),
    backgroundImagePath: buildTemplateAssetPath(DEFAULT_PPT_TEMPLATE_ID, 'master-background.png'),
    headerLogoPath: buildTemplateAssetPath(DEFAULT_PPT_TEMPLATE_ID, 'header-logo.png'),
  },
  master: {
    name: 'CUHK_SZ_DEFAULT_MASTER',
    backgroundBox: { x: 0, y: 0, w: 13.333333, h: 7.5 },
    headerLogoBox: { x: 10.4, y: 0.02, w: 2.8, h: 0.8 },
  },
}

const PPT_TEMPLATE_REGISTRY: Record<string, PptBrandTemplate> = {
  [CUHK_SZ_DEFAULT_TEMPLATE.id]: CUHK_SZ_DEFAULT_TEMPLATE,
}

const EMU_PER_INCH = 914400

export interface SkillTemplateDef {
  skill_id: string
  name: string
  version: string
  extracted_pptx_path: string
  enabled: boolean
}

// Known visual themes for built-in skill templates. Keys are skill_id.
// Without this, all skill templates would inherit the CUHK purple theme and background.
const SKILL_KNOWN_THEMES: Record<string, PptBrandTheme> = {
  ppt_template_cuhk_business: {
    primary: '276221',
    secondary: '1a4217',
    accent: 'd4a017',
    light: 'e8f5e9',
    bg: 'FFFFFF',
    text: '1b2223',
    muted: '5d8453',
  },
  // Dark background template: bg is navy so text must be white/light
  ppt_template_academic_defense: {
    primary: 'FFFFFF',    // white titles on navy background
    secondary: 'E8EAF6',  // light indigo body text
    accent: 'FFC107',     // gold accent
    light: '283593',      // darker navy for card backgrounds
    bg: '1a237e',         // navy slide background (set via PptxGenJS master)
    text: 'FFFFFF',       // white body text
    muted: 'B0BEC5',      // light gray muted text
  },
  // --- Phase 1 DeckDocument templates (generic color-only placeholders) ---
  business_report_light: {
    primary: '1F3864',    // deep navy
    secondary: '2B4590',  // medium navy
    accent: 'C9A227',     // gold
    light: 'EBF0FA',      // light blue-gray for card bg
    bg: 'FFFFFF',
    text: '1C2A4A',       // dark navy body text
    muted: '6B7FA8',      // muted blue-gray
  },
  chinese_season_light: {
    primary: '8B1A1A',    // warm crimson
    secondary: '5C1010',  // deep crimson
    accent: 'C9A227',     // traditional gold
    light: 'FBF0E0',      // warm cream for card bg
    bg: 'FFFDF8',         // near-white warm background
    text: '3D1C00',       // dark warm brown body text
    muted: '9B7040',      // muted gold-brown
  },
  // --- Phase 4 real PPTX skill templates ---
  // 蓝金简约学术风毕业论文答辩 — navy + gold on white
  academic_defense: {
    primary: '162A5B',    // deep navy blue
    secondary: '1F3E8A',  // academic blue
    accent: 'C9A227',     // gold
    light: 'EBF0FA',      // light blue-gray for card bg
    bg: 'FFFFFF',
    text: '162A5B',       // dark navy body text
    muted: '6B7FA8',      // muted blue-gray
  },
  // 手绘线条简约中国风立夏节气 — warm red + ink black on cream
  chinese_season: {
    primary: '8B1A1A',    // warm crimson
    secondary: '5C1010',  // deep crimson
    accent: 'C9A227',     // traditional gold
    light: 'FBF0E0',      // warm cream
    bg: 'FFFDF8',         // near-white warm
    text: '3D1C00',       // dark warm brown
    muted: '9B7040',      // muted gold-brown
  },
  // 简约弧形几何工作汇报商务通用 — blue-gray + white on dark navy
  business_report: {
    primary: '1F3864',    // deep navy
    secondary: '2B4590',  // medium navy
    accent: '4472C4',     // business blue accent
    light: 'EBF0FA',      // light blue-gray
    bg: 'FFFFFF',
    text: '1C2A4A',       // dark navy body text
    muted: '6B7FA8',      // muted blue-gray
  },
}

export function registerSkillTemplate(def: SkillTemplateDef): void {
  const base = CUHK_SZ_DEFAULT_TEMPLATE
  // Use skill-specific theme if known; otherwise fall back to the default.
  const theme: PptBrandTheme = SKILL_KNOWN_THEMES[def.skill_id] ?? base.theme
  const template: PptBrandTemplate = {
    id: def.skill_id,
    name: def.name,
    type: 'brand-master',
    source: 'skill',
    slideSize: base.slideSize,
    theme,
    margins: base.margins,
    safeArea: base.safeArea,
    assets: {
      sourceTemplatePath: def.extracted_pptx_path,
      // Skill templates do NOT inherit the CUHK background/logo.
      // Leaving these blank means a plain-color background with no logo overlay.
      backgroundImagePath: '',
      headerLogoPath: '',
    },
    master: {
      // Use a unique master name so PptxGenJS doesn't confuse masters across presentations.
      name: `${def.skill_id.toUpperCase().replace(/-/g, '_')}_MASTER`,
      backgroundBox: base.master.backgroundBox,
      headerLogoBox: base.master.headerLogoBox,
    },
  }
  console.log('[pptTemplateRegistry] registerSkillTemplate', def.skill_id, 'theme.primary=', theme.primary)
  PPT_TEMPLATE_REGISTRY[def.skill_id] = template
}

export function listPptTemplates(): Array<{
  id: string
  name: string
  description?: string
  previewColor?: string
  theme: PptBrandTheme
  source: PptBrandTemplate['source']
  slideSize: PptBrandTemplate['slideSize']
}> {
  return Object.values(PPT_TEMPLATE_REGISTRY).map((t) => ({
    id: t.id,
    name: t.name,
    description: undefined,
    previewColor: t.theme.primary,
    theme: t.theme,
    source: t.source,
    slideSize: t.slideSize,
  }))
}

export async function loadSkillTemplates(userDataPath: string): Promise<void> {
  const jsonPath = path.join(userDataPath, 'template-skills.json')
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8')
    const entries: SkillTemplateDef[] = JSON.parse(raw)
    for (const entry of entries) {
      if (entry.enabled && entry.extracted_pptx_path && fs.existsSync(entry.extracted_pptx_path)) {
        registerSkillTemplate(entry)
      }
    }
  } catch {
    // File not yet created — no skill templates loaded
  }
}

export function resolvePptBrandTemplate(templateId?: string | null): PptBrandTemplate {
  const normalizedId = String(templateId || '').trim()
  if (normalizedId && PPT_TEMPLATE_REGISTRY[normalizedId]) {
    return PPT_TEMPLATE_REGISTRY[normalizedId]
  }
  return PPT_TEMPLATE_REGISTRY[DEFAULT_PPT_TEMPLATE_ID]
}
