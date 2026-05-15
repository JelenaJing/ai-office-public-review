/**
 * 论文质量控制模块（移植自 NFTCORE/textfigure 质量控制功能）
 * 
 * 功能：
 * 1. 知识树检查（验证内容准确性）
 * 2. 全文审查（检查整体质量、一致性、学术规范）
 */

import type { AppSettings } from './settingsStore'
import { completeText } from './llmClient'

/**
 * 知识树检查结果
 */
export interface KnowledgeTreeCheckResult {
  /** 是否通过检查 */
  passed: boolean
  /** 检查意见 */
  feedback: string
  /** 建议的改进点 */
  suggestions: string[]
}

/**
 * 全文审查结果
 */
export interface FullReviewResult {
  /** 总体评分（1-5） */
  overallScore: number
  /** 审查意见 */
  feedback: string
  /** 强项 */
  strengths: string[]
  /** 弱项 */
  weaknesses: string[]
  /** 改进建议 */
  suggestions: string[]
}

/**
 * 知识树检查（验证章节内容的准确性和完整性）
 * 
 * 移植自 NFTCORE check_knowledge_tree 逻辑
 * 
 * @param settings - 应用设置
 * @param sectionText - 章节文本
 * @param sectionTitle - 章节标题
 * @param topic - 论文主题
 * @param language - 语言
 * @returns 检查结果
 */
export async function checkKnowledgeTree(
  settings: AppSettings,
  sectionText: string,
  sectionTitle: string,
  topic: string,
  language: 'zh' | 'en',
): Promise<KnowledgeTreeCheckResult> {
  const languageInstruction = language === 'zh' ? '用简体中文回复' : 'Reply in English'

  const prompt = `You are an expert academic reviewer. Check the following section for factual accuracy, completeness, and logical coherence.

Topic: ${topic}
Section: ${sectionTitle}

Section Content:
${sectionText}

Review Criteria:
1. Are the claims supported and accurate?
2. Is the logic coherent and well-structured?
3. Are there any missing key points?
4. Is the depth sufficient for academic standards?

Return your assessment in JSON format:
{
  "passed": true/false,
  "feedback": "Overall assessment",
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}

${languageInstruction}. Return JSON only.`

  try {
    const response = await completeText(settings, {
      systemPrompt: 'You are an expert academic reviewer. You assess academic content for accuracy and quality. Always return valid JSON.',
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 1000,
    })

    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('未找到 JSON 内容')
    }

    const result = JSON.parse(jsonMatch[0]) as { passed: boolean; feedback: string; suggestions: string[] }

    return {
      passed: result.passed ?? true,
      feedback: String(result.feedback || ''),
      suggestions: Array.isArray(result.suggestions) ? result.suggestions.map(String) : [],
    }
  } catch (error) {
    console.error('知识树检查失败:', error)
    return {
      passed: true,
      feedback: '检查过程出错，默认通过',
      suggestions: [],
    }
  }
}

/**
 * 全文审查（检查论文整体质量）
 * 
 * 移植自 NFTCORE 全文审查逻辑
 * 
 * @param settings - 应用设置
 * @param paperMarkdown - 完整论文 markdown
 * @param topic - 论文主题
 * @param paperType - 论文类型
 * @param language - 语言
 * @returns 审查结果
 */
export async function reviewFullPaper(
  settings: AppSettings,
  paperMarkdown: string,
  topic: string,
  paperType: 'review' | 'research' | 'thesis_research',
  language: 'zh' | 'en',
): Promise<FullReviewResult> {
  const languageInstruction = language === 'zh' ? '用简体中文回复' : 'Reply in English'
  const paperTypeLabel = paperType === 'research' ? '研究论文' : paperType === 'review' ? '综述论文' : '学位论文'

  const prompt = `You are a senior academic editor. Review the following ${paperTypeLabel} comprehensively.

Topic: ${topic}
Paper Type: ${paperType}

Paper Content (first 3000 characters):
${paperMarkdown.slice(0, 3000)}

Review Criteria:
1. Structure: Is the structure logical and well-organized?
2. Content: Is the content comprehensive and accurate?
3. Writing: Is the writing clear, concise, and academic?
4. Citations: Are citations appropriately placed?
5. Coherence: Is the flow between sections smooth?

Return your assessment in JSON format:
{
  "overall_score": 4,
  "feedback": "Overall assessment of the paper",
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}

${languageInstruction}. Return JSON only.`

  try {
    const response = await completeText(settings, {
      systemPrompt: 'You are a senior academic editor. You provide comprehensive paper reviews. Always return valid JSON.',
      userPrompt: prompt,
      temperature: 0.4,
      maxTokens: 1500,
    })

    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('未找到 JSON 内容')
    }

    const result = JSON.parse(jsonMatch[0]) as {
      overall_score: number
      feedback: string
      strengths: string[]
      weaknesses: string[]
      suggestions: string[]
    }

    return {
      overallScore: Math.max(1, Math.min(5, Number(result.overall_score) || 3)),
      feedback: String(result.feedback || ''),
      strengths: Array.isArray(result.strengths) ? result.strengths.map(String) : [],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses.map(String) : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions.map(String) : [],
    }
  } catch (error) {
    console.error('全文审查失败:', error)
    return {
      overallScore: 3,
      feedback: '审查过程出错，默认评分',
      strengths: [],
      weaknesses: [],
      suggestions: [],
    }
  }
}
