export interface ExpandInstructionParams {
  contextBefore?: string
  contextAfter?: string
  customPrompt?: string
}

/**
 * Builds the main instruction string for the writing assistant.
 * Keep it concise and action-oriented — the selected text is sent separately
 * as `documentText`, and context goes in `extraContext`.
 */
export function buildExpandInstruction(params: ExpandInstructionParams): string {
  const { customPrompt } = params

  const parts: string[] = [
    '请对当前选中文本进行扩写和丰富：保留原文所有句子，在此基础上补充细节、展开描述或增加分析。',
    [
      '扩写规则：',
      '1. 严格使用与原文完全相同的语言（中文/英文等），禁止翻译',
      '2. 必须保留原文每一句话，只在此基础上补充展开，不得删改原文',
      '3. 涉及数学公式或推导时，使用完整 LaTeX 格式（$..$ 行内 / $$...$$ 块公式）',
      '4. 不改变原文核心观点、结论和立场',
    ].join('\n'),
    '输出要求：只返回扩写后的最终文本，不加任何解释、标题、引号或前缀。',
  ]

  if (customPrompt && customPrompt.trim()) {
    parts.push('用户补充要求：' + customPrompt.trim())
  }

  return parts.join('\n\n')
}

/**
 * Builds the extraContext string from surrounding document context.
 * This is sent separately so the backend places it as background info,
 * not as part of the "document to process".
 */
export function buildExpandExtraContext(params: Pick<ExpandInstructionParams, 'contextBefore' | 'contextAfter'>): string | undefined {
  const { contextBefore, contextAfter } = params
  const parts: string[] = []
  if (contextBefore?.trim()) {
    parts.push('前文背景（仅供衔接参考，请勿重新输出）：\n' + contextBefore.trim())
  }
  if (contextAfter?.trim()) {
    parts.push('后文背景（仅供衔接参考，请勿重新输出）：\n' + contextAfter.trim())
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
