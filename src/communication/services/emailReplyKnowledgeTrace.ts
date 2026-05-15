/**
 * Email reply knowledge trace — silent self-check mechanism.
 *
 * Determines whether a generated email reply actually used the knowledge
 * snippets that were retrieved, using lightweight local heuristics only.
 * No extra LLM calls are made.
 */

import type { EmailReplyKnowledgeSnippet, EmailReplyKnowledgeTrace } from '../../types/email'

/* ------------------------------------------------------------------ */
/*  Stop-word list (terms too generic to count as "knowledge usage")   */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  // Chinese common words
  '您好', '谢谢', '感谢', '会议', '时间', '安排', '确认', '邮件',
  '工作', '请', '希望', '关于', '以下', '相关', '问题', '情况',
  '内容', '处理', '进行', '完成', '需要', '可以', '应该', '建议',
  '通知', '附件', '日程', '参加', '参与', '联系', '回复',
  // English common words
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in',
  'and', 'for', 'this', 'that', 'with', 'have', 'will', 'be', 'at',
  'by', 'from', 'or', 'on', 'it', 'as', 'we', 'you', 'i', 'he',
  'she', 'they', 'our', 'your', 'has', 'had', 'not', 'can', 'please',
])

/* ------------------------------------------------------------------ */
/*  Keyword extraction                                                 */
/* ------------------------------------------------------------------ */

function extractKeyTerms(snippets: EmailReplyKnowledgeSnippet[]): string[] {
  const termFreq = new Map<string, number>()

  for (const snippet of snippets) {
    const text = snippet.text
    // Chinese terms: 2–10 chars, no punctuation
    const chineseTerms = text.match(/[\u4e00-\u9fa5]{2,10}/g) ?? []
    // English terms: 4+ chars (avoids trivial words)
    const englishTerms = text.match(/[A-Za-z][A-Za-z0-9]{3,}/g) ?? []

    for (const term of [...chineseTerms, ...englishTerms]) {
      if (!STOP_WORDS.has(term)) {
        termFreq.set(term, (termFreq.get(term) ?? 0) + 1)
      }
    }
  }

  // Prefer terms that appear multiple times, or long-enough terms
  return Array.from(termFreq.entries())
    .filter(([term, freq]) => freq > 1 || term.length >= 4)
    .sort(([, fa], [, fb]) => fb - fa)
    .map(([term]) => term)
    .slice(0, 40)
}

/* ------------------------------------------------------------------ */
/*  Public: estimate knowledge usage in a draft                       */
/* ------------------------------------------------------------------ */

export function estimateKnowledgeUsageInDraft(
  draft: string,
  snippets: EmailReplyKnowledgeSnippet[],
): { likelyUsed: boolean; matchedTerms: string[] } {
  if (!draft || snippets.length === 0) return { likelyUsed: false, matchedTerms: [] }

  const terms = extractKeyTerms(snippets)
  const matchedTerms = terms.filter((term) => draft.includes(term))

  return {
    likelyUsed: matchedTerms.length >= 2,
    matchedTerms,
  }
}

/* ------------------------------------------------------------------ */
/*  Public: build a full trace record                                 */
/* ------------------------------------------------------------------ */

export function buildEmailReplyKnowledgeTrace(input: {
  mailId: string
  selectedKnowledgeIds: string[]
  snippets: EmailReplyKnowledgeSnippet[]
  knowledgeContextLength: number
  promptHasKnowledgeContext: boolean
  promptHasKnowledgeRequirement: boolean
  draft: string
  error?: string
}): EmailReplyKnowledgeTrace {
  const {
    mailId,
    selectedKnowledgeIds,
    snippets,
    knowledgeContextLength,
    promptHasKnowledgeContext,
    promptHasKnowledgeRequirement,
    draft,
    error,
  } = input

  const createdAt = new Date().toISOString()
  const draftGenerated = draft.length > 0
  const draftLength = draft.length
  const retrievalAttempted = selectedKnowledgeIds.length > 0
  const retrievedSnippetCount = snippets.length
  const retrievedSnippetsPreview = snippets.slice(0, 5).map((s) => ({
    knowledgeId: s.knowledgeId,
    sourceTitle: s.sourceTitle,
    textPreview: s.text.slice(0, 80),
    score: s.score,
  }))

  /* Error path */
  if (error) {
    return {
      mailId, createdAt, selectedKnowledgeIds,
      retrievalAttempted, retrievedSnippetCount, retrievedSnippetsPreview,
      knowledgeContextLength, promptHasKnowledgeContext, promptHasKnowledgeRequirement,
      draftGenerated, draftLength,
      likelyUsedKnowledge: false,
      status: 'error',
      reason: `生成预回复时出现错误：${error}`,
    }
  }

  /* No knowledge selected */
  if (selectedKnowledgeIds.length === 0) {
    return {
      mailId, createdAt, selectedKnowledgeIds,
      retrievalAttempted: false, retrievedSnippetCount: 0, retrievedSnippetsPreview: [],
      knowledgeContextLength: 0, promptHasKnowledgeContext: false, promptHasKnowledgeRequirement,
      draftGenerated, draftLength,
      likelyUsedKnowledge: false,
      status: 'not_selected',
      reason: '当前邮件未选择知识库，已按普通预回复逻辑生成。',
    }
  }

  /* Knowledge selected but nothing retrieved */
  if (retrievedSnippetCount === 0) {
    return {
      mailId, createdAt, selectedKnowledgeIds,
      retrievalAttempted: true, retrievedSnippetCount: 0, retrievedSnippetsPreview: [],
      knowledgeContextLength, promptHasKnowledgeContext, promptHasKnowledgeRequirement,
      draftGenerated, draftLength,
      likelyUsedKnowledge: false,
      status: 'fallback_no_relevant_snippets',
      reason: '已选择知识库，但未检索到高度相关片段，已按邮件正文生成回复。',
    }
  }

  /* Retrieved but not in prompt — this is a bug */
  if (!promptHasKnowledgeContext || knowledgeContextLength === 0) {
    return {
      mailId, createdAt, selectedKnowledgeIds,
      retrievalAttempted: true, retrievedSnippetCount, retrievedSnippetsPreview,
      knowledgeContextLength, promptHasKnowledgeContext, promptHasKnowledgeRequirement,
      draftGenerated, draftLength,
      likelyUsedKnowledge: false,
      status: 'retrieved_but_not_in_prompt',
      reason: '知识库片段已检索到，但未进入生成 prompt。',
    }
  }

  /* Draft not generated despite knowledge being in prompt */
  if (!draftGenerated) {
    return {
      mailId, createdAt, selectedKnowledgeIds,
      retrievalAttempted: true, retrievedSnippetCount, retrievedSnippetsPreview,
      knowledgeContextLength, promptHasKnowledgeContext, promptHasKnowledgeRequirement,
      draftGenerated: false, draftLength: 0,
      likelyUsedKnowledge: false,
      status: 'error',
      reason: '知识库片段已进入 prompt，但草稿未生成。',
    }
  }

  /* Estimate whether draft actually used knowledge content */
  const { likelyUsed } = estimateKnowledgeUsageInDraft(draft, snippets)

  if (likelyUsed) {
    return {
      mailId, createdAt, selectedKnowledgeIds,
      retrievalAttempted: true, retrievedSnippetCount, retrievedSnippetsPreview,
      knowledgeContextLength, promptHasKnowledgeContext, promptHasKnowledgeRequirement,
      draftGenerated, draftLength,
      likelyUsedKnowledge: true,
      status: 'likely_used',
      reason: '知识库片段已进入 prompt，生成回复中检测到相关知识库内容。',
    }
  }

  return {
    mailId, createdAt, selectedKnowledgeIds,
    retrievalAttempted: true, retrievedSnippetCount, retrievedSnippetsPreview,
    knowledgeContextLength, promptHasKnowledgeContext, promptHasKnowledgeRequirement,
    draftGenerated, draftLength,
    likelyUsedKnowledge: false,
    status: 'in_prompt_but_unclear_usage',
    reason: '知识库片段已进入 prompt，但生成回复中未检测到明显知识库内容。',
  }
}

/* ------------------------------------------------------------------ */
/*  Reserved: AI self-check (not called by default)                   */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function evaluateKnowledgeUsageWithAI(_input: {
  draft: string
  snippets: EmailReplyKnowledgeSnippet[]
}): Promise<{ likelyUsed: boolean; reason: string }> {
  // Not enabled by default. Enable via VITE_ENABLE_EMAIL_REPLY_KNOWLEDGE_SELF_CHECK=true
  // when that flag is needed. For now always return a neutral result.
  return { likelyUsed: false, reason: 'AI self-check not enabled.' }
}
