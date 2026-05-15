export const KNOWLEDGE_CANONICAL_SCHEMA_VERSION = '1.1' as const

export type KnowledgeCanonicalSchemaVersion = '1.0' | '1.1'
export type KnowledgeCanonicalPresentAs = 'word' | 'ppt' | 'pdf'
export type KnowledgeCanonicalDocType = 'text' | 'presentation' | 'pdf_doc' | 'image_doc'

export interface KnowledgeCanonicalBbox {
  x: number
  y: number
  w: number
  h: number
}

export interface KnowledgeCanonicalSourceAsset {
  asset_id: string
  format: string
  original_name: string
}

export interface KnowledgeCanonicalTag {
  name: string
  group: 'semantic' | 'style' | 'structure' | 'asset'
  source: 'manual' | 'ai' | 'system'
  confidence?: number
}

export interface KnowledgeCanonicalSemantics {
  summary: string
  tags: KnowledgeCanonicalTag[]
  template_confidence: number
  material_confidence: number
}

export interface KnowledgeCanonicalBlock {
  block_id: string
  block_type: 'text' | 'heading' | 'paragraph' | 'list' | 'table' | 'image' | 'shape' | 'caption' | 'footer' | 'note'
  role?: string
  order: number
  layout?: { bbox: KnowledgeCanonicalBbox; z_index?: number }
  style?: Record<string, string | number | boolean | undefined>
  content: {
    text?: string
    rows?: string[][]
    asset_id?: string
    image_rel?: string
    image_transform?: {
      rot_deg?: number
      flip_h?: boolean
      flip_v?: boolean
      crop_ltrb?: { l: number; t: number; r: number; b: number }
    }
  }
  source_anchor?: Record<string, unknown>
  regions?: Array<{
    region_id: string
    region_type: string
    bbox: KnowledgeCanonicalBbox
    caption?: string
  }>
}

export interface KnowledgeCanonicalSurface {
  surface_id: string
  surface_type: 'page' | 'slide' | 'canvas'
  index: number
  size?: { width: number; height: number }
  blocks: KnowledgeCanonicalBlock[]
}

export interface KnowledgeCanonicalDocument {
  schema_version: KnowledgeCanonicalSchemaVersion
  document_id: string
  doc_type: KnowledgeCanonicalDocType
  present_as?: KnowledgeCanonicalPresentAs
  title: string
  source_assets: KnowledgeCanonicalSourceAsset[]
  metadata: {
    created_at: string
    status: string
    language?: string
  }
  semantics: KnowledgeCanonicalSemantics
  surfaces: KnowledgeCanonicalSurface[]
}

export function isKnowledgeCanonicalDocument(value: unknown): value is KnowledgeCanonicalDocument {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.schema_version === '1.0' || record.schema_version === '1.1')
    && typeof record.document_id === 'string'
    && Array.isArray(record.surfaces)
}