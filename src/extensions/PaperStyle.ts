import { Extension } from '@tiptap/core'

type PaperStyleMap = {
  textIndent?: string | null
  lineHeight?: string | null
  marginTop?: string | null
  marginBottom?: string | null
  fontFamily?: string | null
  fontSize?: string | null
  breakBefore?: string | null
}

type StyleCommandOptions = {
  all?: boolean
}

const TARGET_NODES = ['paragraph', 'heading', 'blockquote']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paperStyle: {
      setBlockStyle: (styles: PaperStyleMap, options?: StyleCommandOptions) => ReturnType
      clearBlockStyle: (options?: StyleCommandOptions) => ReturnType
    }
  }
}

function parseStyle(style: string | null | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const chunk of String(style || '').split(';')) {
    const [rawKey, rawValue] = chunk.split(':')
    const key = String(rawKey || '').trim()
    const value = String(rawValue || '').trim()
    if (key && value) result[key] = value
  }
  return result
}

function toStyleString(styleMap: Record<string, string>): string | null {
  const entries = Object.entries(styleMap).filter(([, value]) => String(value || '').trim())
  if (entries.length === 0) return null
  return entries.map(([key, value]) => `${key}: ${value}`).join('; ')
}

function normalizeStyleMap(styleMap: PaperStyleMap): Record<string, string | null> {
  return {
    'text-indent': styleMap.textIndent ?? null,
    'line-height': styleMap.lineHeight ?? null,
    'margin-top': styleMap.marginTop ?? null,
    'margin-bottom': styleMap.marginBottom ?? null,
    'font-family': styleMap.fontFamily ?? null,
    'font-size': styleMap.fontSize ?? null,
    'break-before': styleMap.breakBefore ?? null,
  }
}

function updateSelectedBlocks(state: any, styles: PaperStyleMap, options?: StyleCommandOptions): any {
  const { from, to } = state.selection
  const tr = state.tr
  const normalized = normalizeStyleMap(styles)
  const start = options?.all ? 0 : from
  const end = options?.all ? state.doc.content.size : to

  state.doc.nodesBetween(start, end, (node: any, pos: number) => {
    if (!TARGET_NODES.includes(node.type.name)) return
    const currentStyle = parseStyle(node.attrs.paperStyle)
    for (const [key, value] of Object.entries(normalized)) {
      if (!value) delete currentStyle[key]
      else currentStyle[key] = value
    }
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      paperStyle: toStyleString(currentStyle),
    })
  })

  return tr
}

export const PaperStyle = Extension.create({
  name: 'paperStyle',

  addGlobalAttributes() {
    return [
      {
        types: TARGET_NODES,
        attributes: {
          paperStyle: {
            default: null,
            parseHTML: (element) => {
              const styles = [
                element.style.textIndent ? `text-indent: ${element.style.textIndent}` : '',
                element.style.lineHeight ? `line-height: ${element.style.lineHeight}` : '',
                element.style.marginTop ? `margin-top: ${element.style.marginTop}` : '',
                element.style.marginBottom ? `margin-bottom: ${element.style.marginBottom}` : '',
                element.style.fontFamily ? `font-family: ${element.style.fontFamily}` : '',
                element.style.fontSize ? `font-size: ${element.style.fontSize}` : '',
                element.style.breakBefore ? `break-before: ${element.style.breakBefore}` : '',
              ].filter(Boolean)
              return styles.length > 0 ? styles.join('; ') : null
            },
            renderHTML: (attributes) => {
              if (!attributes.paperStyle) return {}
              // Strip margin-top/bottom: kept in data-paper-style for DOCX writing,
              // but must NOT appear as inline styles or they override editor CSS rules
              // for heading/paragraph spacing (e.g. h1 { margin: 36px 0 20px })
              const styleMap = parseStyle(attributes.paperStyle)
              delete styleMap['margin-top']
              delete styleMap['margin-bottom']
              const styleStr = toStyleString(styleMap)
              return styleStr ? { style: styleStr } : {}
            },
          },
          semanticRole: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-semantic-role'),
            renderHTML: (attributes) => {
              if (!attributes.semanticRole) return {}
              return { 'data-semantic-role': attributes.semanticRole }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockStyle:
        (styles: PaperStyleMap, options?: StyleCommandOptions) =>
        ({ state, dispatch }) => {
          const tr = updateSelectedBlocks(state, styles, options)
          if (dispatch) dispatch(tr)
          return true
        },
      clearBlockStyle:
        (options?: StyleCommandOptions) =>
        ({ state, dispatch }) => {
          const tr = updateSelectedBlocks(state, {
            textIndent: null,
            lineHeight: null,
            marginTop: null,
            marginBottom: null,
            fontFamily: null,
            fontSize: null,
            breakBefore: null,
          }, options)
          if (dispatch) dispatch(tr)
          return true
        },
    }
  },
})