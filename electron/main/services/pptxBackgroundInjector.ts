/**
 * pptxBackgroundInjector.ts
 *
 * Stage 3-B1 MVP: inject decorative background shapes from a Skill template.pptx
 * into every slide of a generated output.pptx using JSZip string surgery.
 *
 * Strategy:
 *   1. Read slide1.xml from the template PPTX.
 *   2. Extract shapes that are decorative (not full-slide, no visible text).
 *   3. Renumber their shape IDs to 9000+ to avoid conflicts.
 *   4. Remap any r:embed media references to new IDs; copy media files.
 *   5. Inject the extracted shapes into every output slide after </p:grpSpPr>.
 *   6. Update each slide's .rels with any new media relationships.
 *   7. Re-save the output PPTX.
 *
 * On any failure: returns { status:'warning' } — never crashes the generation.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

/** Standard 13.33"×7.5" widescreen slide in EMUs */
const SLIDE_CX = 12_192_000
const SLIDE_CY = 6_858_000
/** A shape whose both dims exceed this fraction of the slide is treated as "full background" */
const FULL_SLIDE_FRACTION = 0.85

export interface BackgroundInjectionResult {
  status: 'ok' | 'skipped' | 'warning'
  slidesPatched: number
  mediaCopied: number
  skipReason?: string
  warning?: string
}

/* ──────────────────────────────────────────── helpers ── */

/** Extract the shape extent cx/cy from an <a:ext ...> node within the shape XML */
function getShapeExtent(shapeXml: string): { cx: number; cy: number } {
  const m = shapeXml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)
  if (!m) return { cx: 0, cy: 0 }
  return { cx: parseInt(m[1], 10), cy: parseInt(m[2], 10) }
}

/** True if the shape covers ≥ 85 % of the slide in BOTH dimensions */
function isFullSlideShape(shapeXml: string): boolean {
  const { cx, cy } = getShapeExtent(shapeXml)
  return cx >= SLIDE_CX * FULL_SLIDE_FRACTION && cy >= SLIDE_CY * FULL_SLIDE_FRACTION
}

/** True if the shape contains any non-whitespace <a:t> text */
function hasVisibleText(shapeXml: string): boolean {
  return /<a:t>[^<]+<\/a:t>/.test(shapeXml)
}

/** Return the insertion point index: position right after </p:grpSpPr> inside spTree */
function findInsertionPoint(slideXml: string): number {
  const marker = '</p:grpSpPr>'
  const idx = slideXml.indexOf(marker)
  return idx === -1 ? -1 : idx + marker.length
}

/** Replace `id="…"` inside the first <p:cNvPr …> tag of a shape element */
function renameShapeId(shapeXml: string, newId: number, newName: string): string {
  return shapeXml.replace(/<p:cNvPr\b([^/]*)\/>/, (match) =>
    match
      .replace(/\bid="[^"]*"/, `id="${newId}"`)
      .replace(/\bname="[^"]*"/, `name="${newName}"`)
  )
}

/** Parse all <Relationship> entries from a rels XML string */
function parseRels(relsXml: string): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>()
  for (const m of relsXml.matchAll(/<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"/g)) {
    map.set(m[1], { type: m[2], target: m[3] })
  }
  return map
}

/** Collect all unique r:embed and r:link values from a block of XML */
function collectRidRefs(xml: string): string[] {
  const ids = new Set<string>()
  for (const m of xml.matchAll(/r:embed="([^"]+)"/g)) ids.add(m[1])
  for (const m of xml.matchAll(/r:link="([^"]+)"/g)) ids.add(m[1])
  return [...ids]
}

const REL_TYPE_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/* ──────────────────────────────────────────── main ── */

export async function applyTemplateBackground(opts: {
  outputPptxPath: string
  templatePptxPath: string
  templateId: string
}): Promise<BackgroundInjectionResult> {
  const { outputPptxPath, templatePptxPath, templateId } = opts
  console.log(`[pptxBackgroundInjector] templateId=${templateId}`)

  try {
    /* 1 ── Read template PPTX */
    const tplBuf = await fs.readFile(templatePptxPath)
    const tplZip = await JSZip.loadAsync(tplBuf)

    const slide1File = tplZip.file('ppt/slides/slide1.xml')
    if (!slide1File) {
      return { status: 'skipped', slidesPatched: 0, mediaCopied: 0, skipReason: 'template slide1.xml not found' }
    }
    const slide1Xml = await slide1File.async('string')

    /* 2 ── Extract decorative background shapes */
    const rawShapes: string[] = []

    for (const m of slide1Xml.matchAll(/<p:sp[\s>][\s\S]*?<\/p:sp>/g)) {
      const sp = m[0]
      if (isFullSlideShape(sp)) continue   // skip full-slide bg rect
      if (hasVisibleText(sp)) continue      // skip title/text boxes
      rawShapes.push(sp)
    }
    for (const m of slide1Xml.matchAll(/<p:pic[\s>][\s\S]*?<\/p:pic>/g)) {
      rawShapes.push(m[0])
    }

    if (rawShapes.length === 0) {
      return { status: 'skipped', slidesPatched: 0, mediaCopied: 0, skipReason: 'no decorative background shapes in template slide1' }
    }
    console.log(`[pptxBackgroundInjector] ${rawShapes.length} background shape(s) to inject`)

    /* 3 ── Build media rId remap table */
    const relsFile = tplZip.file('ppt/slides/_rels/slide1.xml.rels')
    const tplRels = relsFile ? parseRels(await relsFile.async('string')) : new Map()

    const rawEmbedIds = collectRidRefs(rawShapes.join(''))

    interface MediaEntry { oldRid: string; newRid: string; tplZipPath: string; newMediaName: string }
    const mediaEntries: MediaEntry[] = []
    let ridIdx = 0

    for (const oldRid of rawEmbedIds) {
      const rel = tplRels.get(oldRid)
      if (!rel) continue
      // Only remap media (image) relationships
      if (!rel.type.includes('image') && !rel.target.includes('media/')) continue

      const origName = path.posix.basename(rel.target)
      const ext = path.posix.extname(origName)
      const newMediaName = `injbg_${templateId}_${ridIdx}${ext}`
      const tplZipPath = rel.target.startsWith('../')
        ? `ppt/${rel.target.slice(3)}`
        : `ppt/slides/${rel.target}`

      mediaEntries.push({ oldRid, newRid: `injBgRid${ridIdx}`, tplZipPath, newMediaName })
      ridIdx++
    }

    /* 4 ── Build final injected XML (renumber IDs, remap rIds) */
    const injectedXml = rawShapes
      .map((sp, idx) => {
        let xml = renameShapeId(sp, 9000 + idx, `bg_${templateId}_${idx}`)
        for (const e of mediaEntries) {
          xml = xml.replaceAll(`r:embed="${e.oldRid}"`, `r:embed="${e.newRid}"`)
          xml = xml.replaceAll(`r:link="${e.oldRid}"`, `r:link="${e.newRid}"`)
        }
        return xml
      })
      .join('')

    /* 5 ── Load output PPTX */
    const outBuf = await fs.readFile(outputPptxPath)
    const outZip = await JSZip.loadAsync(outBuf)

    /* 5a ── Copy media files into output PPTX */
    let mediaCopied = 0
    for (const e of mediaEntries) {
      const srcFile = tplZip.file(e.tplZipPath)
      if (!srcFile) {
        console.warn(`[pptxBackgroundInjector] media not found in template: ${e.tplZipPath}`)
        continue
      }
      const data = await srcFile.async('nodebuffer')
      outZip.file(`ppt/media/${e.newMediaName}`, data)
      mediaCopied++
    }

    /* 5b ── Patch every slide */
    const slideKeys = Object.keys(outZip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10)
        const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10)
        return na - nb
      })

    let slidesPatched = 0
    for (const slideKey of slideKeys) {
      const slideFile = outZip.file(slideKey)
      if (!slideFile) continue

      const slideXml = await slideFile.async('string')
      const insertAt = findInsertionPoint(slideXml)
      if (insertAt === -1) continue

      const patched = slideXml.slice(0, insertAt) + injectedXml + slideXml.slice(insertAt)
      outZip.file(slideKey, patched)

      // Update .rels for media
      if (mediaEntries.length > 0) {
        const slideNum = slideKey.match(/slide(\d+)\.xml$/)?.[1] ?? '1'
        const relsKey = `ppt/slides/_rels/slide${slideNum}.xml.rels`
        const relsEntry = outZip.file(relsKey)
        const existingRels = relsEntry
          ? await relsEntry.async('string')
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'

        const newRelEntries = mediaEntries
          .map((e) => `<Relationship Id="${e.newRid}" Type="${REL_TYPE_IMAGE}" Target="../media/${e.newMediaName}"/>`)
          .join('')

        outZip.file(relsKey, existingRels.replace('</Relationships>', newRelEntries + '</Relationships>'))
      }

      slidesPatched++
    }

    if (slidesPatched === 0) {
      return { status: 'skipped', slidesPatched: 0, mediaCopied, skipReason: 'no slide files found in output PPTX' }
    }

    /* 6 ── Write back */
    const patchedBuf = await outZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    await fs.writeFile(outputPptxPath, patchedBuf)

    console.log(`[pptxBackgroundInjector] patched slides=${slidesPatched} mediaCopied=${mediaCopied}`)
    return { status: 'ok', slidesPatched, mediaCopied }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[pptxBackgroundInjector] warning: ${msg}`)
    return { status: 'warning', slidesPatched: 0, mediaCopied: 0, warning: msg }
  }
}
