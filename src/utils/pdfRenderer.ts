/**
 * PDF → page images renderer using pdfjs-dist.
 * Used by the homework-solving mode to render PDF pages into PNG dataUrls
 * that can be sent to a vision LLM for question extraction.
 */

export interface PdfPageImage {
  pageNumber: number
  width: number
  height: number
  dataUrl: string
}

let pdfJsModulePromise: Promise<typeof import('pdfjs-dist')> | null = null

async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs' as string).then(
      (mod: typeof import('pdfjs-dist')) => {
        const workerUrl = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
        mod.GlobalWorkerOptions.workerSrc = workerUrl
        return mod
      },
    )
  }
  return pdfJsModulePromise
}

export async function renderPdfPages(
  data: ArrayBuffer,
  targetWidth = 1200,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfPageImage[]> {
  const pdfJs = await loadPdfJs()
  const pdfDocument = await pdfJs.getDocument({ data: new Uint8Array(data) }).promise
  const pages: PdfPageImage[] = []
  const outputScale = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const widthScale = targetWidth / Math.max(baseViewport.width, 1)
      const viewport = page.getViewport({ scale: Math.min(Math.max(widthScale, 0.85), 2) })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) throw new Error('浏览器无法创建 PDF 预览画布。')

      canvas.width = Math.round(viewport.width * outputScale)
      canvas.height = Math.round(viewport.height * outputScale)
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)

      await page.render({ canvasContext: context, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise

      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        dataUrl: canvas.toDataURL('image/png'),
      })

      onProgress?.(pageNumber, pdfDocument.numPages)
    }
  } finally {
    await pdfDocument.destroy().catch(() => undefined)
  }

  return pages
}
