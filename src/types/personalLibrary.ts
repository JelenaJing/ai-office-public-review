// Personal Library — shared types (completely independent from knowledge.ts)

export type PersonalFileSourceType = 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'image' | 'pptx'
export type PersonalFileExtractionStatus = 'pending' | 'ready' | 'failed' | 'image-only'

export interface PersonalFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface PersonalFile {
  id: string
  name: string
  originalName: string
  folderId: string | null
  sourceType: PersonalFileSourceType
  mimeType: string
  size: number
  hash: string
  importedAt: string
  updatedAt: string
  storedRelativePath: string          // relative to personal-library root, e.g. files/abc123/source.pdf
  extractedRelativePath: string       // relative to personal-library root, e.g. files/abc123/extracted.txt
  extractionStatus: PersonalFileExtractionStatus
  extractedTextLength: number
  previewText: string
  errorMessage?: string
}

export interface PersonalLibraryRegistry {
  version: 1
  folders: PersonalFolder[]
  files: PersonalFile[]
}

export interface PersonalImportResult {
  imported: PersonalFile[]
  duplicates: PersonalFile[]
  failed: Array<{ filePath: string; fileName: string; error: string }>
  canceled: boolean
}
