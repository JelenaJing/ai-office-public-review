import type {
  GenerateImagePayload,
  ImageGenerationMode,
  ImagePromptBuildResult,
  ImageReferenceItem,
  ImageReferenceRole,
  ImageReferenceSelection,
  ImageStyleOptions,
  ImageStyleProfile,
} from '../../../types/imageGeneration'

export const DEFAULT_IMAGE_STYLE_OPTIONS: ImageStyleOptions = {
  styleStrength: 72,
  strictStyleLock: false,
  preserveComposition: false,
  creativity: 42,
}

export const DEFAULT_IMAGE_GENERATION_MODE: ImageGenerationMode = 'style-continuation'

const DEFAULT_ROLE_TOTALS_WITH_PRIMARY: Record<ImageReferenceRole, number> = {
  'primary-style': 0.65,
  style: 0.25,
  content: 0.1,
}

const DEFAULT_ROLE_TOTALS_WITHOUT_PRIMARY: Record<Exclude<ImageReferenceRole, 'primary-style'>, number> = {
  style: 0.7,
  content: 0.3,
}

type StyleFamily =
  | 'flat-illustration'
  | 'painterly'
  | 'comic'
  | 'photography'
  | '3d-render'
  | 'generic'

const STYLE_FAMILY_KEYWORDS: Record<StyleFamily, string[]> = {
  'flat-illustration': [
    'flat illustration', 'editorial illustration', 'vector', '2d', '2d illustration', 'flat design', '扁平', '插画', '编辑插画', 'vector art',
  ],
  painterly: [
    'watercolor', 'oil painting', 'gouache', 'painted', 'brushwork', '水彩', '油画', '绘画感', '笔触', 'painterly',
  ],
  comic: [
    'comic', 'manga', 'anime', 'cel shading', 'line art', '漫画', '动漫', '赛璐璐', '卡通',
  ],
  photography: [
    'photo', 'photography', 'photographic', 'ultra realistic', 'hyper realistic', 'cinematic', 'dslr', '镜头', '摄影', '写实', '超写实',
  ],
  '3d-render': [
    '3d', 'render', 'octane', 'cgi', 'isometric', 'blender', 'unreal', '3d render', '三维', '渲染', '建模',
  ],
  generic: [],
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function normalizeReferenceId(value: string): string {
  return String(value || '').trim()
}

function inferStyleFamily(profile: ImageStyleProfile | null | undefined): StyleFamily {
  const medium = String(profile?.medium || '').toLowerCase()
  if (!medium) return 'generic'
  if (/(flat|editorial|vector|illustration)/i.test(medium)) return 'flat-illustration'
  if (/(watercolor|oil|paint|gouache|pastel)/i.test(medium)) return 'painterly'
  if (/(comic|manga|anime|cartoon|line art)/i.test(medium)) return 'comic'
  if (/(photo|photography|cinematic|realistic)/i.test(medium)) return 'photography'
  if (/(3d|render|cgi|octane|unreal|blender)/i.test(medium)) return '3d-render'
  return 'generic'
}

function roleSortValue(role: ImageReferenceRole): number {
  if (role === 'primary-style') return 0
  if (role === 'style') return 1
  return 2
}

export function normalizeImageStyleOptions(input?: Partial<ImageStyleOptions> | null): ImageStyleOptions {
  return {
    styleStrength: clamp(Number(input?.styleStrength ?? DEFAULT_IMAGE_STYLE_OPTIONS.styleStrength), 0, 100),
    strictStyleLock: Boolean(input?.strictStyleLock ?? DEFAULT_IMAGE_STYLE_OPTIONS.strictStyleLock),
    preserveComposition: Boolean(input?.preserveComposition ?? DEFAULT_IMAGE_STYLE_OPTIONS.preserveComposition),
    creativity: clamp(Number(input?.creativity ?? DEFAULT_IMAGE_STYLE_OPTIONS.creativity), 0, 100),
  }
}

export function normalizeImageReferenceSelections(items: ImageReferenceSelection[], preferredPrimaryId?: string | null): ImageReferenceSelection[] {
  const normalized = items
    .map((item) => ({
      id: normalizeReferenceId(item.id),
      role: item.role,
      weight: Number(item.weight || 0),
    }))
    .filter((item) => item.id)

  const deduped: ImageReferenceSelection[] = []
  const seen = new Set<string>()
  for (const item of normalized) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    deduped.push(item)
  }

  let primaryId = normalizeReferenceId(preferredPrimaryId || '')
  if (!primaryId) {
    primaryId = deduped.find((item) => item.role === 'primary-style')?.id || ''
  }

  const references = deduped.map((item) => {
    if (primaryId && item.id === primaryId) {
      return { ...item, role: 'primary-style' as const }
    }
    if (item.role === 'primary-style') {
      return { ...item, role: 'style' as const }
    }
    return item
  })

  references.sort((left, right) => {
    const roleDiff = roleSortValue(left.role) - roleSortValue(right.role)
    if (roleDiff !== 0) return roleDiff
    return left.id.localeCompare(right.id)
  })

  const primaryCount = references.filter((item) => item.role === 'primary-style').length
  const styleItems = references.filter((item) => item.role === 'style')
  const contentItems = references.filter((item) => item.role === 'content')

  if (primaryCount > 0) {
    return references.map((item) => {
      if (item.role === 'primary-style') return { ...item, weight: DEFAULT_ROLE_TOTALS_WITH_PRIMARY['primary-style'] }
      if (item.role === 'style') return { ...item, weight: styleItems.length > 0 ? DEFAULT_ROLE_TOTALS_WITH_PRIMARY.style / styleItems.length : 0 }
      return { ...item, weight: contentItems.length > 0 ? DEFAULT_ROLE_TOTALS_WITH_PRIMARY.content / contentItems.length : 0 }
    })
  }

  const totalStyle = styleItems.length > 0 ? DEFAULT_ROLE_TOTALS_WITHOUT_PRIMARY.style : 0
  const totalContent = contentItems.length > 0 ? DEFAULT_ROLE_TOTALS_WITHOUT_PRIMARY.content : 0
  const divisor = totalStyle + totalContent || 1

  return references.map((item) => {
    if (item.role === 'style') return { ...item, weight: styleItems.length > 0 ? totalStyle / styleItems.length / divisor : 0 }
    return { ...item, weight: contentItems.length > 0 ? totalContent / contentItems.length / divisor : 0 }
  })
}

export function upsertImageReferenceRole(items: ImageReferenceSelection[], documentId: string, role: ImageReferenceRole): ImageReferenceSelection[] {
  const normalizedId = normalizeReferenceId(documentId)
  if (!normalizedId) return normalizeImageReferenceSelections(items)

  const next = items.filter((item) => normalizeReferenceId(item.id) !== normalizedId)
  next.push({ id: normalizedId, role, weight: 0 })
  return normalizeImageReferenceSelections(next, role === 'primary-style' ? normalizedId : undefined)
}

export function removeImageReferenceSelection(items: ImageReferenceSelection[], documentId: string): ImageReferenceSelection[] {
  const normalizedId = normalizeReferenceId(documentId)
  return normalizeImageReferenceSelections(items.filter((item) => normalizeReferenceId(item.id) !== normalizedId))
}

export function getPrimaryStyleReferenceId(items: ImageReferenceSelection[]): string | null {
  return normalizeImageReferenceSelections(items).find((item) => item.role === 'primary-style')?.id || null
}

export function getSelectedImageReferenceIds(items: ImageReferenceSelection[]): string[] {
  return normalizeImageReferenceSelections(items).map((item) => item.id)
}

export function imageReferenceSelectionsEqual(left: ImageReferenceSelection[], right: ImageReferenceSelection[]): boolean {
  const normalizedLeft = normalizeImageReferenceSelections(left)
  const normalizedRight = normalizeImageReferenceSelections(right)
  if (normalizedLeft.length !== normalizedRight.length) return false
  return normalizedLeft.every((item, index) => {
    const matched = normalizedRight[index]
    return item.id === matched.id && item.role === matched.role && Math.abs(item.weight - matched.weight) < 0.0001
  })
}

export function buildStyleProfilePrompt(profile: ImageStyleProfile | null | undefined, styleOptions: ImageStyleOptions, generationMode: ImageGenerationMode): string {
  if (!profile) return ''

  const strengthDescriptor = styleOptions.styleStrength >= 85
    ? 'Keep the reference style very tightly locked.'
    : styleOptions.styleStrength >= 60
      ? 'Keep the reference style clearly dominant.'
      : 'Keep the reference style visible but allow measured variation.'
  const compositionDescriptor = styleOptions.preserveComposition
    ? 'Preserve the primary reference composition rhythm and spatial organization as much as possible.'
    : 'Do not clone the exact composition unless needed; transfer the style language first.'
  const modeDescriptor = generationMode === 'reference-redraw'
    ? 'Generation mode: reference redraw. Prefer near-image-to-image behavior and stay close to the primary reference visual relationships.'
    : 'Generation mode: style continuation. Keep the primary reference visual language while allowing new subject matter.'

  return [
    `Primary style profile: medium=${profile.medium}; palette=${profile.palette.join(', ')}; lighting=${profile.lighting}; linework=${profile.linework}; texture=${profile.texture}; composition=${profile.composition}; mood=${profile.mood}.`,
    profile.forbidden.length > 0 ? `Avoid these conflicting directions: ${profile.forbidden.join(', ')}.` : '',
    strengthDescriptor,
    compositionDescriptor,
    modeDescriptor,
  ].filter(Boolean).join(' ')
}

function uniqueRemovedKeywords(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

export function sanitizeConflictingStyleKeywords(rawPrompt: string, profile: ImageStyleProfile | null | undefined, styleOptions: ImageStyleOptions): { sanitizedPrompt: string; removedKeywords: string[] } {
  const source = String(rawPrompt || '').trim()
  if (!source) {
    return { sanitizedPrompt: '', removedKeywords: [] }
  }

  if (!styleOptions.strictStyleLock || !profile) {
    return { sanitizedPrompt: source, removedKeywords: [] }
  }

  const family = inferStyleFamily(profile)
  const removed: string[] = []
  let sanitized = ` ${source} `

  const conflictKeywords = Object.entries(STYLE_FAMILY_KEYWORDS)
    .filter(([familyKey]) => familyKey !== family)
    .flatMap(([, keywords]) => keywords)

  for (const keyword of conflictKeywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matcher = new RegExp(`(^|[^\\w])(${escaped})(?=[^\\w]|$)`, 'ig')
    sanitized = sanitized.replace(matcher, (match, prefix, captured) => {
      removed.push(String(captured || match).trim())
      return prefix || ' '
    })
  }

  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim()
  return {
    sanitizedPrompt: sanitized || source,
    removedKeywords: uniqueRemovedKeywords(removed),
  }
}

function buildRolePrompt(references: ImageReferenceItem[], styleOptions: ImageStyleOptions): string {
  if (references.length === 0) return 'No reference images are selected.'
  const primary = references.find((item) => item.role === 'primary-style') || null
  const styles = references.filter((item) => item.role === 'style')
  const contents = references.filter((item) => item.role === 'content')

  return [
    primary
      ? `Primary style image: ${primary.name || primary.id} with weight ${primary.weight.toFixed(2)}. This image defines the dominant painting/rendering language.`
      : 'No primary style image is set. Treat the selected references as secondary cues only and do not promise strict style inheritance.',
    styles.length > 0
      ? `Additional style references: ${styles.map((item) => `${item.name || item.id} (${item.weight.toFixed(2)})`).join(', ')}.`
      : 'No secondary style references are selected.',
    contents.length > 0
      ? `Content references: ${contents.map((item) => `${item.name || item.id} (${item.weight.toFixed(2)})`).join(', ')}. Use them for subject, layout, or object hints without overriding the primary style.`
      : 'No content reference images are selected.',
    styleOptions.strictStyleLock ? 'Strict style lock is enabled: conflicting user style wording must be suppressed.' : 'Strict style lock is disabled: user style wording may still introduce some variation.',
  ].join(' ')
}

export function buildFinalImagePrompt(payload: GenerateImagePayload): ImagePromptBuildResult {
  const references = payload.references.slice().sort((left, right) => {
    const roleDiff = roleSortValue(left.role) - roleSortValue(right.role)
    if (roleDiff !== 0) return roleDiff
    return (left.order ?? 999) - (right.order ?? 999)
  })
  const styleOptions = normalizeImageStyleOptions(payload.styleOptions)
  const { sanitizedPrompt, removedKeywords } = sanitizeConflictingStyleKeywords(payload.prompt, payload.styleProfile, styleOptions)
  const styleProfilePrompt = buildStyleProfilePrompt(payload.styleProfile, styleOptions, payload.generationMode)
  const rolePrompt = buildRolePrompt(references, styleOptions)
  const fallbackNotes: string[] = []

  if (!references.some((item) => item.role === 'primary-style')) {
    fallbackNotes.push('No primary-style image set; strong style inheritance is disabled and the request falls back to weaker reference guidance.')
  }
  if (payload.generationMode === 'reference-redraw') {
    fallbackNotes.push('Reference redraw mode is advisory only unless the underlying provider supports real img2img behavior.')
  }

  const creativityDescriptor = styleOptions.creativity >= 70
    ? 'Allow moderate creative expansion beyond the reference set.'
    : styleOptions.creativity <= 30
      ? 'Keep generation conservative and stay very close to the reference set.'
      : 'Balance reference fidelity with controlled novelty.'

  const finalPrompt = [
    styleProfilePrompt,
    rolePrompt,
    creativityDescriptor,
    sanitizedPrompt ? `User intent: ${sanitizedPrompt}` : 'User intent: (empty)',
  ].filter(Boolean).join('\n\n')

  const negativePrompt = styleOptions.strictStyleLock && payload.styleProfile?.forbidden?.length
    ? payload.styleProfile.forbidden.join(', ')
    : String(payload.negativePrompt || '').trim()

  return {
    rawPrompt: payload.prompt,
    sanitizedPrompt,
    removedKeywords,
    styleProfilePrompt,
    rolePrompt,
    finalPrompt,
    negativePrompt,
    fallbackNotes,
  }
}

export function buildImageReferenceDebugItems(references: ImageReferenceItem[]): Array<Pick<ImageReferenceItem, 'id' | 'name' | 'role' | 'weight' | 'origin' | 'order'>> {
  return references.map((item) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    weight: item.weight,
    origin: item.origin,
    order: item.order,
  }))
}

export function summarizeImageReferenceRoles(references: ImageReferenceItem[]): string[] {
  const normalized = references.slice().sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
  return normalized.map((item) => `${item.role}:${item.name || item.id}@${Math.round(item.weight * 100)}%`)
}