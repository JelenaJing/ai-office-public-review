export type WritingRulePromptMode = 'document-generate' | 'document-rewrite' | 'knowledge-discuss'

export function buildMinimalWritingRuleText(mode: WritingRulePromptMode): string {
  const lines: string[] = []

  lines.push('除非用户明确要求，否则不得编造未提供的事实、数据、结论。')
  lines.push('专业术语、实体名、关键缩写尽量保持一致。')
  lines.push('若用户未明确要求调整结构，保持现有段落组织与章节顺序。')
  lines.push('日期、数字、称谓、编号默认保持不变，除非用户明确要求修改。')
  if (mode === 'document-rewrite') {
    lines.push('本次为局部改写时，仅修改命中片段，不改动其他段落。')
  }

  if (!lines.length) return ''
  return [
    '【最小规则集】以下规则用于稳定生成行为；若与用户明确要求冲突，以用户要求为准：',
    ...lines.map((line, index) => `${index + 1}. ${line}`),
  ].join('\n')
}

