/**
 * PPT Content Package — pure semantic content, zero style/template data.
 *
 * A ContentPackage is produced once by the LLM and persisted to disk.
 * Template switching only re-renders; it never re-creates this package.
 */

import type { PptxSlideDefinition } from '../../electron/main/services/pptxGenerator'

/** A single image asset referenced by a slide. */
export interface PptContentAsset {
  /** 0-based slide index this asset belongs to */
  slideIndex: number
  /** Absolute local path to the already-generated image file */
  imagePath: string
}

/**
 * The content-only representation of a presentation.
 *
 * FORBIDDEN fields: templateId, theme, font, color, background, layout
 * coordinates, master information, animation, style config.
 */
export interface PresentationContentPackage {
  id: string
  schemaVersion: '1.0'
  kind: 'presentation'
  title: string
  sourcePrompt: string
  slides: PptxSlideDefinition[]
  assets: PptContentAsset[]
  createdAt: string
  /** 'partial' while generation is in progress or was stopped; 'completed' when all slides are done */
  status: 'partial' | 'completed'
  /** Total slides planned in the outline */
  expectedSlideCount: number
  /** Slides actually generated so far */
  completedSlideCount: number
  /** ISO timestamp when the user stopped generation early */
  stoppedAt?: string
  /** The skill/template ID last applied to this package */
  activeSkillId?: string
  /** Full outline plan for all expected slides. Enables resume of partial generation. */
  outlinePlan?: Array<{ index: number; role: string; heading: string; hint?: string }>
}

/** Result of applying a Skill/template to a ContentPackage. */
export interface RenderedArtifact {
  contentPackageId: string
  skillId: string
  outputPath: string
  slideCount: number
  renderedAt: string
}

/** Minimal Skill manifest — describes a PPT template without any content. */
export interface PptSkillManifest {
  id: string
  name: string
  category: 'presentation'
  requiresLLM: false
  supportedContentKinds: ['presentation']
  /** Short hex color string for the preview swatch, e.g. '1A1A2E' */
  previewColor: string
  description: string
}
