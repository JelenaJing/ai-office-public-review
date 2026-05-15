import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'

type ImageAlignment = 'left' | 'center' | 'right'

function parsePixelValue(value: string | null | undefined): number | null {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*px/i) || normalized.match(/^(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function readStyleValue(styleText: string | null | undefined, propertyName: string): string | null {
  const normalized = String(styleText || '')
  if (!normalized) return null
  const match = normalized.match(new RegExp(`${propertyName}\s*:\s*([^;]+)`, 'i'))
  return match?.[1]?.trim() || null
}

function normalizeAlignment(value: string | null | undefined): ImageAlignment {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'left' || normalized === 'right') return normalized
  return 'center'
}

function buildFigureStyle(alignment: ImageAlignment): string {
  if (alignment === 'left') return 'margin:16px auto 16px 0;text-align:left;width:fit-content;max-width:100%;'
  if (alignment === 'right') return 'margin:16px 0 16px auto;text-align:right;width:fit-content;max-width:100%;'
  return 'margin:16px auto;text-align:center;width:fit-content;max-width:100%;'
}

function buildImageStyle(width: number | null, height: number | null): string {
  const rules = ['display:block', 'max-width:100%', 'border-radius:4px']
  if (width) rules.push(`width:${width}px`)
  if (height) rules.push(`height:${height}px`)
  return `${rules.join(';')};`
}

function extractImageAttrs(element: HTMLElement): Record<string, unknown> | false {
  const figure = element.matches('figure') ? element : element.closest('figure[data-image-node="true"]')
  const image = element.matches('img') ? element : element.querySelector('img')
  if (!image) return false

  const caption = figure?.querySelector('figcaption')?.textContent?.trim() || null
  const figureStyle = figure?.getAttribute('style') || ''
  const imageStyle = image.getAttribute('style') || ''
  const width = parsePixelValue(image.getAttribute('data-width-px'))
    || parsePixelValue(image.getAttribute('width'))
    || parsePixelValue(readStyleValue(imageStyle, 'width'))
  const height = parsePixelValue(image.getAttribute('data-height-px'))
    || parsePixelValue(image.getAttribute('height'))
    || parsePixelValue(readStyleValue(imageStyle, 'height'))
  const alignment = normalizeAlignment(
    figure?.getAttribute('data-alignment')
    || figure?.getAttribute('data-align')
    || image.getAttribute('data-alignment')
    || readStyleValue(figureStyle, 'text-align'),
  )

  return {
    src: image.getAttribute('src'),
    alt: image.getAttribute('alt'),
    title: image.getAttribute('title'),
    width,
    height,
    alignment,
    caption,
  }
}

function readOoxmlAttr(element: HTMLElement, name: string): string | null {
  // Look on the element itself, its closest ooxml image wrapper, or a nested img.
  const candidates: (HTMLElement | null)[] = [
    element,
    element.closest?.('div[data-ooxml-object="image"]') as HTMLElement | null,
    element.closest?.('figure[data-image-node="true"]') as HTMLElement | null,
    element.querySelector?.('img') as HTMLElement | null,
  ]
  for (const el of candidates) {
    if (!el) continue
    const value = el.getAttribute?.(name)
    if (value != null && value !== '') return value
  }
  return null
}

const RichImage = Image.extend({
  addAttributes() {
    const ooxmlPassthrough = (name: string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => readOoxmlAttr(element, name),
      renderHTML: (attrs: Record<string, unknown>) => {
        const value = attrs[name]
        return value ? { [name]: String(value) } : {}
      },
    })
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const attrs = extractImageAttrs(element)
          return attrs ? attrs.width ?? null : null
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const attrs = extractImageAttrs(element)
          return attrs ? attrs.height ?? null : null
        },
      },
      alignment: {
        default: 'center',
        parseHTML: (element: HTMLElement) => {
          const attrs = extractImageAttrs(element)
          return attrs ? attrs.alignment ?? 'center' : 'center'
        },
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const attrs = extractImageAttrs(element)
          return attrs ? attrs.caption ?? null : null
        },
      },
      // OOXML pass-through attributes so TipTap round-trip does not strip them.
      'data-source-xml': ooxmlPassthrough('data-source-xml'),
      'data-source-id': ooxmlPassthrough('data-source-id'),
      'data-relationship-id': ooxmlPassthrough('data-relationship-id'),
      'data-media-path': ooxmlPassthrough('data-media-path'),
      'data-media-content-type': ooxmlPassthrough('data-media-content-type'),
      'data-preview-src': ooxmlPassthrough('data-preview-src'),
      'data-drawing-layout': ooxmlPassthrough('data-drawing-layout'),
      'data-image-width-emu': ooxmlPassthrough('data-image-width-emu'),
      'data-image-height-emu': ooxmlPassthrough('data-image-height-emu'),
      'data-anchor-horizontal': ooxmlPassthrough('data-anchor-horizontal'),
      'data-anchor-vertical': ooxmlPassthrough('data-anchor-vertical'),
      'data-wrap-type': ooxmlPassthrough('data-wrap-type'),
      'data-src-rect': ooxmlPassthrough('data-src-rect'),
      'data-sha1': ooxmlPassthrough('data-sha1'),
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-image-node="true"]',
        getAttrs: (element) => extractImageAttrs(element as HTMLElement),
      },
      {
        tag: 'img[src]',
        getAttrs: (element) => extractImageAttrs(element as HTMLElement),
      },
      {
        // Handle OOXML image divs produced by readOoxmlPackage.
        // These carry the image as a base64 data URL in data-preview-src.
        tag: 'div[data-ooxml-object="image"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          const src = el.getAttribute('data-preview-src')?.trim() || ''
          if (!src) return false
          const alt = el.getAttribute('data-alt')?.trim() || ''
          const title = el.getAttribute('data-title')?.trim() || ''
          const widthPx = parsePixelValue(el.getAttribute('data-image-width-px'))
          const heightPx = parsePixelValue(el.getAttribute('data-image-height-px'))
          const alignment = normalizeAlignment(el.getAttribute('data-alignment') || 'center')
          return { src, alt, title, width: widthPx, height: heightPx, alignment, caption: null }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const width = typeof HTMLAttributes.width === 'number' ? HTMLAttributes.width : parsePixelValue(String(HTMLAttributes.width || ''))
    const height = typeof HTMLAttributes.height === 'number' ? HTMLAttributes.height : parsePixelValue(String(HTMLAttributes.height || ''))
    const alignment = normalizeAlignment(String(HTMLAttributes.alignment || 'center'))
    const caption = String(HTMLAttributes.caption || '').trim()
    const { caption: _caption, alignment: _alignment, width: _width, height: _height, ...rest } = HTMLAttributes
    const imageAttrs = mergeAttributes(this.options.HTMLAttributes, rest, {
      width: width || undefined,
      height: height || undefined,
      'data-width-px': width || undefined,
      'data-height-px': height || undefined,
      style: buildImageStyle(width, height),
    })
    const figureAttrs = {
      'data-image-node': 'true',
      'data-alignment': alignment,
      style: buildFigureStyle(alignment),
    }

    const children: Array<unknown> = [['img', imageAttrs]]
    if (caption) {
      children.push(['figcaption', { 'data-image-caption': 'true' }, caption])
    }
    return ['figure', figureAttrs, ...children]
  },
})

export default RichImage