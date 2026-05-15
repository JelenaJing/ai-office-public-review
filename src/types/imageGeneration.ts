export type ImageReferenceRole = 'primary-style' | 'style' | 'content'

export type ImageReferenceOrigin = 'knowledge-base' | 'upload' | 'generated' | 'local'

export type ImageGenerationMode = 'style-continuation' | 'reference-redraw'

export interface ImageReferenceSelection {
  id: string
  role: ImageReferenceRole
  weight: number
}

export interface ImageReferenceItem {
  id: string
  url: string
  role: ImageReferenceRole
  weight: number
  name?: string
  thumbnailUrl?: string
  origin?: ImageReferenceOrigin
  filePath?: string
  fileName?: string
  contentType?: string
  dataUrl?: string
  order?: number
}

export interface ImageStyleOptions {
  styleStrength: number
  strictStyleLock: boolean
  preserveComposition: boolean
  creativity: number
}

export interface ImageStyleProfileMetrics {
  brightness: number
  contrast: number
  saturation: number
  edgeDensity: number
  colorDiversity: number
  warmRatio: number
  coolRatio: number
  orientation: 'landscape' | 'portrait' | 'square'
}

export interface ImageStyleProfile {
  medium: string
  palette: string[]
  lighting: string
  linework: string
  texture: string
  composition: string
  mood: string
  forbidden: string[]
  summary: string
  extractedAt: string
  sourceImageId?: string
  metrics?: ImageStyleProfileMetrics
}

export interface ImagePromptBuildResult {
  rawPrompt: string
  sanitizedPrompt: string
  removedKeywords: string[]
  styleProfilePrompt: string
  rolePrompt: string
  finalPrompt: string
  negativePrompt: string
  fallbackNotes: string[]
}

export interface ImageGenerationDebugLog {
  rawUserPrompt: string
  sanitizedPrompt: string
  finalPrompt: string
  generationMode: ImageGenerationMode
  styleStrength: number
  strictStyleLock: boolean
  preserveComposition: boolean
  creativity: number
  references: Array<Pick<ImageReferenceItem, 'id' | 'name' | 'role' | 'weight' | 'origin' | 'order'>>
  primaryReference: Pick<ImageReferenceItem, 'id' | 'name' | 'role' | 'weight'> | null
  styleProfile: ImageStyleProfile | null
  attachedToRequest: boolean
  requestPayloadSummary: Record<string, unknown>
  removedKeywords: string[]
  fallbackNotes: string[]
}

export interface GenerateImagePayload {
  prompt: string
  negativePrompt?: string
  aspectRatio?: string
  filename?: string
  workspacePath?: string
  references: ImageReferenceItem[]
  styleOptions: ImageStyleOptions
  generationMode: ImageGenerationMode
  styleProfile?: ImageStyleProfile | null
  traceId?: string
  debug?: {
    enabled: boolean
    source?: string
  }
}