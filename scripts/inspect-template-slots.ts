/**
 * inspect-template-slots.ts
 *
 * Dumps shape inventory (shapeId, shapeName, text, x/y/w/h, orientation,
 * isImage, isVertical) for each slide in the 3 built-in template PPTXes.
 *
 * Output: .debug-template-slots/{templateId}/slide-{n}.json
 *
 * Run:
 *   npm exec --yes --package tsx -- tsx scripts/inspect-template-slots.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import JSZip from 'jszip'

const REPO_ROOT = path.resolve(__dirname, '..')

const TEMPLATES: Array<{ id: string; pptxPath: string; keySlides: number[] }> = [
  {
    id: 'chinese_season',
    pptxPath: path.join(REPO_ROOT, 'electron/main/data/ppt-skills/chinese_season/source-template.pptx'),
    // cover=1, toc=2, section=3, cards=4, content_text=5, closing=19
    keySlides: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 19, 20],
  },
  {
    id: 'business_report',
    pptxPath: path.join(REPO_ROOT, 'electron/main/data/ppt-skills/business_report/source-template.pptx'),
    // cover=1, toc=2, section=3, content=4, closing=23
    keySlides: [1, 2, 3, 4, 5, 6, 7, 8, 23, 24],
  },
  {
    id: 'academic_defense',
    pptxPath: path.join(REPO_ROOT, 'electron/main/data/ppt-skills/academic_defense/source-template.pptx'),
    // cover=1, toc=2, section=3, content=4, closing=23
    keySlides: [1, 2, 3, 4, 5, 6, 7, 8, 23, 24],
  },
]

// ---------------------------------------------------------------------------
// XML parsing helpers
// ---------------------------------------------------------------------------

interface ShapeInfo {
  shapeId: string
  shapeName: string
  text: string
  x: number
  y: number
  w: number
  h: number
  isVertical: boolean
  isImage: boolean
  isPlaceholder: boolean
  fontSize?: number
  raw: string // truncated raw XML for debugging
}

function parseSlideShapes(slideXml: string): ShapeInfo[] {
  const shapes: ShapeInfo[] = []

  // Parse <p:sp> shapes (text shapes)
  const spRe = /<p:sp[\s>][\s\S]*?<\/p:sp>/g
  let m: RegExpExecArray | null
  while ((m = spRe.exec(slideXml)) !== null) {
    const spXml = m[0]
    const idMatch = spXml.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/)
    const offMatch = spXml.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
    const extMatch = spXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/)

    // Check for vertical text (vert="vert" or vert="vert270" or rot on bodyPr)
    const isVertical =
      /vert="vert"/.test(spXml) ||
      /vert="vert270"/.test(spXml) ||
      /vert="mongolianVert"/.test(spXml) ||
      /rot="5400000"/.test(spXml) // 90 degree rotation
    const isPlaceholder = /<p:ph/.test(spXml)

    // Extract all text content
    const texts: string[] = []
    const atRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let at: RegExpExecArray | null
    while ((at = atRe.exec(spXml)) !== null) {
      texts.push(at[1])
    }
    const text = texts.join('').trim()

    // Font size (first rPr sz attribute, in hundredths of a point)
    const szMatch = spXml.match(/<a:rPr[^>]*\bsz="(\d+)"/)
    const fontSize = szMatch ? parseInt(szMatch[1], 10) / 100 : undefined

    shapes.push({
      shapeId: idMatch?.[1] ?? '',
      shapeName: idMatch?.[2] ?? '',
      text: text.slice(0, 200),
      x: parseInt(offMatch?.[1] ?? '0', 10),
      y: parseInt(offMatch?.[2] ?? '0', 10),
      w: parseInt(extMatch?.[1] ?? '0', 10),
      h: parseInt(extMatch?.[2] ?? '0', 10),
      isVertical,
      isImage: false,
      isPlaceholder,
      fontSize,
      raw: spXml.slice(0, 400),
    })
  }

  // Parse <p:pic> shapes (image shapes)
  const picRe = /<p:pic[\s>][\s\S]*?<\/p:pic>/g
  while ((m = picRe.exec(slideXml)) !== null) {
    const picXml = m[0]
    const idMatch = picXml.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/)
    const offMatch = picXml.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
    const extMatch = picXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
    shapes.push({
      shapeId: idMatch?.[1] ?? '',
      shapeName: idMatch?.[2] ?? '',
      text: '',
      x: parseInt(offMatch?.[1] ?? '0', 10),
      y: parseInt(offMatch?.[2] ?? '0', 10),
      w: parseInt(extMatch?.[1] ?? '0', 10),
      h: parseInt(extMatch?.[2] ?? '0', 10),
      isVertical: false,
      isImage: true,
      isPlaceholder: /<p:ph/.test(picXml),
      raw: picXml.slice(0, 200),
    })
  }

  // Sort by y then x for readability
  return shapes.sort((a, b) => a.y - b.y || a.x - b.x)
}

// Convert EMU to cm for human readability (1 inch = 914400 EMU, 1 cm = 360000 EMU)
function emuToCm(emu: number): string {
  return (emu / 360000).toFixed(1) + 'cm'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function inspectTemplate(template: typeof TEMPLATES[0]): Promise<void> {
  const { id, pptxPath, keySlides } = template
  console.log(`\n── Inspecting: ${id} ────────────────────────────────────────`)
  console.log(`   Path: ${pptxPath}`)

  if (!fs.existsSync(pptxPath)) {
    console.error(`   ✗ File not found: ${pptxPath}`)
    return
  }

  const outputDir = path.join(REPO_ROOT, '.debug-template-slots', id)
  fs.mkdirSync(outputDir, { recursive: true })

  const buffer = fs.readFileSync(pptxPath)
  const zip = await JSZip.loadAsync(buffer)

  // Detect total slide count
  let totalSlides = 0
  for (const key of Object.keys(zip.files)) {
    const m = key.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (m) totalSlides = Math.max(totalSlides, parseInt(m[1], 10))
  }
  console.log(`   Total slides: ${totalSlides}`)

  const summaryRows: Array<{
    slide: number
    shapes: number
    textShapes: number
    imageShapes: number
    verticalShapes: number
    texts: string
  }> = []

  for (const slideIdx of keySlides) {
    if (slideIdx > totalSlides) continue
    const slideFile = zip.file(`ppt/slides/slide${slideIdx}.xml`)
    if (!slideFile) continue

    const slideXml = await slideFile.async('text')
    const shapes = parseSlideShapes(slideXml)

    const textShapes = shapes.filter(s => !s.isImage)
    const imageShapes = shapes.filter(s => s.isImage)
    const verticalShapes = shapes.filter(s => s.isVertical)

    // Write detailed JSON
    const outPath = path.join(outputDir, `slide-${String(slideIdx).padStart(2, '0')}.json`)
    const detail = {
      templateId: id,
      slideIndex: slideIdx,
      shapeCount: shapes.length,
      shapes: shapes.map(s => ({
        shapeId: s.shapeId,
        shapeName: s.shapeName,
        text: s.text,
        position: {
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          xCm: emuToCm(s.x),
          yCm: emuToCm(s.y),
          wCm: emuToCm(s.w),
          hCm: emuToCm(s.h),
        },
        isVertical: s.isVertical,
        isImage: s.isImage,
        isPlaceholder: s.isPlaceholder,
        fontSize: s.fontSize,
      })),
    }
    fs.writeFileSync(outPath, JSON.stringify(detail, null, 2), 'utf-8')

    summaryRows.push({
      slide: slideIdx,
      shapes: shapes.length,
      textShapes: textShapes.length,
      imageShapes: imageShapes.length,
      verticalShapes: verticalShapes.length,
      texts: textShapes
        .map(s => `[${s.shapeId}|${s.shapeName}]"${s.text.slice(0, 40)}"${s.isVertical ? ' VERTICAL' : ''}${s.fontSize ? ` ${s.fontSize}pt` : ''}`)
        .join('; '),
    })

    console.log(`\n  Slide ${slideIdx} (${shapes.length} shapes, ${imageShapes.length} images, ${verticalShapes.length} vertical):`)
    for (const s of shapes) {
      const tag = s.isImage ? '🖼 ' : s.isVertical ? '⬆ ' : '   '
      const pos = `(${emuToCm(s.x)},${emuToCm(s.y)}) ${emuToCm(s.w)}×${emuToCm(s.h)}`
      const fsz = s.fontSize ? ` ${s.fontSize}pt` : ''
      const text = s.text ? `"${s.text.slice(0, 60)}"` : '(no text)'
      console.log(`    ${tag}id=${s.shapeId} name="${s.shapeName}" ${pos}${fsz} ${text}`)
    }
  }

  // Write summary
  const summaryPath = path.join(outputDir, '_summary.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summaryRows, null, 2), 'utf-8')
  console.log(`\n  ✓ Saved details to ${outputDir}`)
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║   Template Slot Inspector                            ║')
  console.log('╚══════════════════════════════════════════════════════╝')

  for (const template of TEMPLATES) {
    await inspectTemplate(template)
  }

  console.log('\n\n── Done ──────────────────────────────────────────────────')
  console.log('Output in: .debug-template-slots/')
  console.log('Use the shapeId / shapeName values to update template manifests.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
