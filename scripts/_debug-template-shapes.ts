import JSZip from 'jszip'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

async function main() {
  const files: Record<string, string> = {
    business_report: path.join(ROOT, 'electron/main/data/ppt-skills/business_report/source-template.pptx'),
    academic_defense: path.join(ROOT, 'electron/main/data/ppt-skills/academic_defense/source-template.pptx'),
    chinese_season: path.join(ROOT, 'electron/main/data/ppt-skills/chinese_season/source-template.pptx'),
  }

  for (const [name, p] of Object.entries(files)) {
    const buf = fs.readFileSync(p)
    const zip = await JSZip.loadAsync(buf)
    for (const slideIdx of [4, 5, 7]) {
      const slideFile = zip.file(`ppt/slides/slide${slideIdx}.xml`)
      if (!slideFile) continue
      const xml = await slideFile.async('text')
      const spRe = /<p:sp>[\s\S]*?<\/p:sp>/g
      let m: RegExpExecArray | null
      const shapes: {id:string, x:string, y:string, text:string}[] = []
      while ((m = spRe.exec(xml)) !== null) {
        const sp = m[0]
        const idM = sp.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/)
        const posM = sp.match(/<a:off x="(\d+)" y="(\d+)"/)
        const texts = [...sp.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(t => t[1])
        const combined = texts.join('')
        if (combined.length > 1) {
          shapes.push({ id: idM?.[1] ?? '', x: posM?.[1] ?? '', y: posM?.[2] ?? '', text: combined.slice(0, 100) })
        }
      }
      console.log(`\n${name} slide${slideIdx}:`)
      shapes.forEach(s => console.log(`  [id=${s.id}] x=${s.x} y=${s.y} | text="${s.text}"`))
    }
  }
}

main().catch(console.error)
