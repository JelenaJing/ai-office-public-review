import { createDocumentArtifact, type DocumentArtifact } from '../core'
import type { DocumentSchema } from '../schema'

export type PaperArtifactBoundary = 'compat-result' | 'paper-result' | 'editor-session' | 'compat-task'
export type PaperCommandId =
  | 'generate-body'
  | 'generate-into-document'
  | 'analyze-topic'
  | 'retrieve-references'
  | 'generate-outline'
  | 'generate-section-draft'
  | 'sync-citation-sidecar'
  | 'resume-task'

export interface PaperOutlineSnapshot {
  title?: string
  sections: string[]
}

export interface PaperResultFragments {
  title?: string
  abstract?: string
  sections?: string[]
  markdown?: string
  paperMarkdown?: string
  structuredBlocks?: unknown[]
  ooxmlSnapshot?: unknown
  referenceList?: unknown[]
  figures?: unknown[]
}

export interface CompatArtifactInput {
  artifactId: string
  command: string
  session: Record<string, unknown>
  document: DocumentSchema
  sourceRefs?: string[]
  patches?: never[]
  exportRefs?: string[]
  metadata?: Record<string, unknown>
}

function createCompatOrchestrator(profile: 'freewrite' | 'paper') {
  return {
    createSession(session: Record<string, unknown> = {}) {
      return {
        profile,
        ...session,
      }
    },
    toArtifact(input: CompatArtifactInput): DocumentArtifact {
      return createDocumentArtifact({
        id: input.artifactId,
        profile,
        document: input.document,
        sourceRefs: input.sourceRefs,
        exportRefs: input.exportRefs,
        metadata: {
          ...(input.metadata || {}),
          command: input.command,
          session: input.session,
        },
      })
    },
  }
}

export const freewriteOrchestrator = createCompatOrchestrator('freewrite')
export const paperOrchestrator = createCompatOrchestrator('paper')

export function createPaperSession(session: Record<string, unknown> = {}) {
  return paperOrchestrator.createSession(session)
}

export function toPaperArtifact(input: CompatArtifactInput): DocumentArtifact {
  return paperOrchestrator.toArtifact(input)
}