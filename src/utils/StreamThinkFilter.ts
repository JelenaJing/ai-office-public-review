type FilterState = 'normal' | 'maybe-open' | 'inside' | 'maybe-close'

export function createThinkFilter() {
  let state: FilterState = 'normal'
  let buffer = ''
  const OPEN_TAG = '<think>'
  const CLOSE_TAG = '</think>'

  function push(chunk: string): string {
    let output = ''
    for (const ch of chunk) {
      switch (state) {
        case 'normal':
          if (ch === '<') {
            buffer = '<'
            state = 'maybe-open'
          } else {
            output += ch
          }
          break
        case 'maybe-open':
          buffer += ch
          if (OPEN_TAG.startsWith(buffer)) {
            if (buffer === OPEN_TAG) {
              state = 'inside'
              buffer = ''
            }
          } else {
            output += buffer
            buffer = ''
            state = 'normal'
          }
          break
        case 'inside':
          if (ch === '<') {
            buffer = '<'
            state = 'maybe-close'
          }
          break
        case 'maybe-close':
          buffer += ch
          if (CLOSE_TAG.startsWith(buffer)) {
            if (buffer === CLOSE_TAG) {
              state = 'normal'
              buffer = ''
            }
          } else {
            buffer = ''
            state = 'inside'
          }
          break
      }
    }
    return output
  }

  function flush(): string {
    if (state === 'normal' || state === 'maybe-open') {
      const leftover = buffer
      buffer = ''
      state = 'normal'
      return leftover
    }
    buffer = ''
    state = 'normal'
    return ''
  }

  return { push, flush }
}

export function stripThinkTags(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
  result = result.replace(/<think(?:ing)?>[\s\S]*/gi, '')
  result = result.replace(/<\/think(?:ing)?>/gi, '')
  return result
}

export function stripPreamble(text: string): string {
  const headingMatch = text.match(/^(#{1,6})\s+.+/m)
  if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
    const before = text.slice(0, headingMatch.index).trim()
    if (before.length > 0) {
      return text.slice(headingMatch.index)
    }
  }
  return text
}