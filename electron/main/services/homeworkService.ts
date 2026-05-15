/**
 * Homework question extraction & answer generation service.
 *
 * Two input paths:
 *  - PDF:  receives page images (base64 PNG) → vision LLM extracts questions
 *  - DOCX: reads structured blocks via DocumentEngineService → text LLM extracts questions
 *
 * Answer generation is unified: text LLM with streaming.
 */

import { completeText, streamText, type PromptInput } from './llmClient'
import { DocumentEngineService, type OoxmlBlockSnapshot } from './documentEngineService'
import type { AppSettings } from './settingsStore'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HomeworkQuestion {
  number: string
  text: string
  type: string
  sourceIndex: number
  options?: string[]
  imageContext?: string
}

export interface HomeworkAnswer {
  questionNumber: string
  answer: string
  status: 'pending' | 'generating' | 'done' | 'error'
}

export interface HomeworkResult {
  question: HomeworkQuestion
  answer: HomeworkAnswer
}

export interface PageImageInput {
  pageNumber: number
  base64: string
  mediaType: string
}

/* ------------------------------------------------------------------ */
/*  DOCX blocks → structured markdown                                  */
/* ------------------------------------------------------------------ */

function blocksToStructuredMarkdown(blocks: OoxmlBlockSnapshot[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        lines.push(`${'#'.repeat(block.level ?? 1)} ${block.text}`)
        break
      case 'formula-placeholder':
        if (block.latex) {
          lines.push(block.formulaDisplay === 'inline' ? `$${block.latex}$` : `$$${block.latex}$$`)
        } else {
          lines.push(block.text)
        }
        break
      case 'table-placeholder':
        if (block.cells?.length) {
          for (let r = 0; r < block.cells.length; r += 1) {
            lines.push(`| ${block.cells[r].join(' | ')} |`)
            if (r === 0) lines.push(`| ${block.cells[r].map(() => '---').join(' | ')} |`)
          }
        } else {
          lines.push(block.text)
        }
        break
      case 'image-placeholder':
        lines.push(`[图片: ${block.alt || block.title || ''}]`)
        break
      default:
        if (block.text.trim()) lines.push(block.text)
        break
    }
  }
  return lines.join('\n\n')
}

/* ------------------------------------------------------------------ */
/*  Question extraction                                                */
/* ------------------------------------------------------------------ */

const EXTRACTION_SYSTEM_PROMPT = `你是一位专业的作业题目解析助手。用户会提供一份作业文档的内容，你需要从中提取出所有独立的题目。

请严格以 JSON 数组格式返回，每道题包含以下字段：
- number: 题号（如 "1", "2", "3(a)" 等）
- text: 完整的题目文本（保留公式，使用 LaTeX 格式 $...$ 或 $$...$$）
- type: 题目类型（"选择题" | "填空题" | "简答题" | "计算题" | "证明题" | "编程题" | "其他"）
- options: 选择题的选项数组（如 ["A. ...", "B. ..."]），非选择题省略此字段

只输出 JSON 数组，不要输出其他内容。如果无法识别任何题目，返回空数组 []。`

function buildExtractionUserPrompt(content: string, sourceType: 'pdf-pages' | 'docx', pageCount?: number): string {
  if (sourceType === 'pdf-pages') {
    const hint = pageCount && pageCount > 1
      ? `以下是作业文档的 ${pageCount} 张页面图片（按顺序排列），`
      : '以下是作业文档的页面图片，'
    return `${hint}请从中提取所有独立题目。注意保留公式的完整性，用 LaTeX 格式表示数学公式。跨页的题目请合并为一道完整题目。`
  }
  return `以下是作业文档的结构化内容，请提取其中所有的题目：\n\n${content}`
}

function parseQuestionsJson(text: string): HomeworkQuestion[] {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const startIndex = cleaned.indexOf('[')
  const endIndex = cleaned.lastIndexOf(']')
  if (startIndex < 0 || endIndex < 0) return []

  try {
    const parsed = JSON.parse(cleaned.slice(startIndex, endIndex + 1)) as Array<Record<string, unknown>>
    return parsed.map((item, idx) => ({
      number: String(item.number ?? idx + 1),
      text: String(item.text ?? ''),
      type: String(item.type ?? '其他'),
      sourceIndex: idx,
      options: Array.isArray(item.options) ? item.options.map(String) : undefined,
    })).filter((q) => q.text.trim().length > 0)
  } catch {
    return []
  }
}

/** Maximum pages sent to the vision LLM in a single request. */
const MAX_PAGES_FOR_EXTRACTION = 10

export async function extractQuestionsFromPdfImages(
  settings: AppSettings,
  pageImages: PageImageInput[],
  onProgress?: (current: number, total: number) => void,
): Promise<HomeworkQuestion[]> {
  const pages = pageImages.slice(0, MAX_PAGES_FOR_EXTRACTION)
  onProgress?.(0, pages.length)

  const input: PromptInput = {
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildExtractionUserPrompt('', 'pdf-pages', pages.length),
    images: pages.map((p) => ({ base64: p.base64, mediaType: p.mediaType })),
    temperature: 0.1,
    maxTokens: 6000,
  }

  const result = await completeText(settings, input)
  onProgress?.(pages.length, pages.length)
  const questions = parseQuestionsJson(result)
  for (const q of questions) {
    q.sourceIndex = 1
  }
  return questions
}

export async function extractQuestionsFromDocx(
  settings: AppSettings,
  filePath: string,
): Promise<{ questions: HomeworkQuestion[]; blocks: OoxmlBlockSnapshot[] }> {
  const engine = new DocumentEngineService()
  const snapshot = await engine.readOoxmlPackage(filePath)
  if (snapshot.status !== 'ok' || !snapshot.blocks.length) {
    throw new Error(`无法读取 DOCX 文件: ${snapshot.status}`)
  }

  const markdown = blocksToStructuredMarkdown(snapshot.blocks)
  const input: PromptInput = {
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildExtractionUserPrompt(markdown, 'docx'),
    temperature: 0.1,
    maxTokens: 4000,
  }

  const result = await completeText(settings, input)
  const questions = parseQuestionsJson(result)
  return { questions, blocks: snapshot.blocks }
}

function deduplicateQuestions(questions: HomeworkQuestion[]): HomeworkQuestion[] {
  const seen = new Set<string>()
  return questions.filter((q) => {
    const key = q.number + '::' + q.text.slice(0, 60)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ------------------------------------------------------------------ */
/*  Answer generation                                                  */
/* ------------------------------------------------------------------ */

const ANSWER_SYSTEM_PROMPT = `你是一位优秀的老师，擅长清晰、详细地解答各类作业题目。请用中英双语解答，严格按照以下结构输出：

【中文解答】
（完整解题过程）

【English Answer】
（Complete solution in English）

要求：
1. 给出完整的解题过程，不要跳步
2. 数学公式使用 LaTeX 格式（行内 $...$，独立块 $$...$$）
3. 选择题请先给出答案，再给出分析
4. 证明题请给出严格的证明过程
5. 编程题请给出代码和解释
6. 不要使用 Markdown 标题（#）或加粗（**）等格式符号，直接输出纯文本`

function buildAnswerUserPrompt(question: HomeworkQuestion): string {
  let prompt = `请解答以下题目：\n\n**第 ${question.number} 题**（${question.type}）\n\n${question.text}`
  if (question.options?.length) {
    prompt += '\n\n选项：\n' + question.options.join('\n')
  }
  return prompt
}

export async function generateAnswer(
  settings: AppSettings,
  question: HomeworkQuestion,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const input: PromptInput = {
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userPrompt: buildAnswerUserPrompt(question),
    temperature: 0.3,
    maxTokens: 3000,
  }

  return streamText(settings, input, onChunk)
}

export async function generateAllAnswers(
  settings: AppSettings,
  questions: HomeworkQuestion[],
  onProgress: (questionNumber: string, status: 'generating' | 'done' | 'error', chunk?: string, accumulated?: string) => void,
  signal?: { cancelled: boolean },
): Promise<HomeworkResult[]> {
  const results: HomeworkResult[] = []

  for (const question of questions) {
    if (signal?.cancelled) break

    onProgress(question.number, 'generating')
    let accumulated = ''

    try {
      const answer = await generateAnswer(settings, question, (chunk) => {
        accumulated += chunk
        onProgress(question.number, 'generating', chunk, accumulated)
      })

      onProgress(question.number, 'done', undefined, answer)
      results.push({
        question,
        answer: { questionNumber: question.number, answer, status: 'done' },
      })
    } catch (error) {
      onProgress(question.number, 'error', undefined, accumulated)
      results.push({
        question,
        answer: {
          questionNumber: question.number,
          answer: accumulated || `解答失败: ${error instanceof Error ? error.message : String(error)}`,
          status: 'error',
        },
      })
    }
  }

  return results
}

/* ------------------------------------------------------------------ */
/*  Export helpers                                                      */
/* ------------------------------------------------------------------ */

export function exportToMarkdown(results: HomeworkResult[], title?: string): string {
  const lines: string[] = []
  if (title) lines.push(`# ${title} — AI 解答\n`)

  for (const { question, answer } of results) {
    lines.push(`## 第 ${question.number} 题（${question.type}）\n`)
    lines.push(question.text)
    if (question.options?.length) {
      lines.push('\n' + question.options.join('\n'))
    }
    lines.push('\n### 解答\n')
    lines.push(answer.answer || '*（未生成）*')
    lines.push('\n---\n')
  }

  return lines.join('\n')
}
