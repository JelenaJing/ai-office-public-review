/**
 * 论文结构规划模块（移植自 NFTCORE/textfigure/paper_structure.py）
 * 使用 LLM 动态生成论文章节结构，而非固定模板
 */

import type { AppSettings } from './settingsStore'
import { completeText } from './llmClient'
import type { ReferenceItem } from './openAlexClient'

/**
 * 论文章节计划
 */
export interface SectionPlan {
  /** 章节标题 */
  title: string
  /** 章节描述 */
  description: string
  /** 重要性（1-5，5最重要） */
  importance: number
  /** 计划图片数量（NFTCORE 工作流当前最多 1 张） */
  plannedFigureCount: number
}

/**
 * 论文计划
 */
export interface PaperPlan {
  /** 论文主题 */
  topic: string
  /** 论文类型 */
  paperType: 'review' | 'research' | 'thesis_research'
  /** 规划模式：fixed 为固定骨架，dynamic 为 LLM 动态生成 */
  planMode: 'fixed' | 'dynamic'
  /** 章节列表（4-8个） */
  sections: SectionPlan[]
  /** 总计划图片数 */
  totalPlannedFigures: number
}

function buildFixedResearchSections(language: 'zh' | 'en'): SectionPlan[] {
  if (language === 'zh') {
    return [
      { title: '引言', description: '交代研究背景、问题提出、研究意义与相关文献基础。', importance: 5, plannedFigureCount: 1 },
      { title: '实验设备', description: '说明实验设备、实验条件、关键参数与方法流程，保证可复现性。', importance: 4, plannedFigureCount: 1 },
      { title: '实验结果分析', description: '系统展示实验数据、关键发现、趋势变化及与既有研究的对照。', importance: 5, plannedFigureCount: 1 },
      { title: '理论分析', description: '从理论模型、机理解释和验证角度分析实验结果，并给出理论支撑。', importance: 4, plannedFigureCount: 1 },
    ]
  }

  return [
    { title: 'Introduction', description: 'Present the research background, problem definition, significance, and literature grounding.', importance: 5, plannedFigureCount: 1 },
    { title: 'Experimental Equipment', description: 'Describe the equipment, experimental setup, key parameters, and procedures for reproducibility.', importance: 4, plannedFigureCount: 1 },
    { title: 'Experimental Results Analysis', description: 'Present the empirical data, major findings, trend analysis, and comparison with prior work.', importance: 5, plannedFigureCount: 1 },
    { title: 'Theoretical Analysis', description: 'Explain the mechanisms, theoretical models, and validation logic that interpret the observed results.', importance: 4, plannedFigureCount: 1 },
  ]
}

/**
 * 使用 LLM 动态生成论文结构计划
 * 
 * 移植自 NFTCORE paper_structure.py 的 build_paper_plan_basic()
 * 
 * @param settings - 应用设置
 * @param params - 生成参数
 * @param references - 文献列表（用于辅助规划）
 * @returns 论文结构计划
 */
export async function buildPaperPlanDynamic(
  settings: AppSettings,
  params: {
    topic: string
    paperType: 'review' | 'research' | 'thesis_research'
    language: 'zh' | 'en'
    extraContext?: string
  },
  references: ReferenceItem[],
): Promise<PaperPlan> {
  const { topic, paperType, language, extraContext } = params
  const paperTypeLabel = paperType === 'review' ? '综述论文' : '学位论文'

  if (paperType === 'research') {
    const sections = buildFixedResearchSections(language)
    return {
      topic,
      paperType,
      planMode: 'fixed',
      sections,
      totalPlannedFigures: sections.reduce((sum, sec) => sum + sec.plannedFigureCount, 0),
    }
  }

  // 构建参考文献上下文（前6篇的标题+摘要）
  const referenceContext = references
    .slice(0, 6)
    .map((ref, idx) => `[${idx + 1}] ${ref.title} (${ref.year ?? 'n.d.'})\n${ref.abstract || '(无摘要)'}`)
    .join('\n\n')

  // 根据论文类型设置不同的 system prompt 和结构指导
  const systemPrompts: Record<string, string> = {
    research:
      '你是一位科学研究论文结构规划专家。你擅长为创新研究设计清晰、逻辑严密的章节结构。典型结构包含 Introduction, Methods, Results, Discussion 等核心部分。',
    review:
      '你是一位学术综述论文结构规划专家。你擅长为文献综述设计主题驱动的章节结构，通常包含 Introduction, 主题分类章节（2-5个）, Future Directions 等。',
    thesis_research:
      '你是一位学位论文结构规划专家。你擅长为学位研究论文设计全面、深入的章节结构，通常比常规研究论文更详细。',
  }

  const structureGuidance: Record<string, string> = {
    research: `研究论文通常包含：
- Introduction: 研究背景与问题定义
- Methods/Methodology: 研究方法与实验设计
- Results: 实验结果与数据分析
- Discussion: 结果讨论与意义阐释
- (可选) Applications/Implications: 应用与影响`,
    review: `综述论文通常包含：
- Introduction: 综述范围与重要性
- 主题分类章节（2-5个）: 按研究主题、技术路线、时间发展等分类
  - 例如: Current Approaches, Emerging Methods, Computational Tools, Challenges and Limitations
- Future Directions/Perspectives: 未来研究方向`,
    thesis_research: `学位论文通常包含：
- Introduction: 详细的研究背景
- Literature Review: 文献回顾（可选独立章节）
- Methodology: 详细的研究方法
- Results: 详细的实验结果
- Discussion: 深入的讨论
- (可选) Implementation/Case Study: 实现与案例`,
  }

  const languageInstruction = language === 'zh' ? '所有章节标题必须使用简体中文。' : 'All section titles must be in English.'

  const userPrompt = `请为以下科学论文主题设计章节结构，生成 4-8 个主体章节（不包括 Abstract 和 Conclusion）。

**论文主题**: ${topic}
**论文类型**: ${paperType} (${paperTypeLabel})
**语言**: ${language === 'zh' ? '中文' : 'English'}
${extraContext ? `**补充上下文**: ${extraContext}` : ''}

**参考文献样本**（用于理解主题细节）：
${referenceContext}

**结构指导**：
${structureGuidance[paperType]}

**要求**：
1. ${languageInstruction}
2. 生成 4-8 个主体章节（不包括 Abstract, Conclusion, References 等固定部分）
3. 每个章节需要：
   - title: 章节标题（简洁清晰）
   - description: 章节内容描述（1-2句话）
   - importance: 章节重要性（1-5，5最重要，通常 Introduction 为5）
  - plannedFigureCount: 计划图片数量（0 或 1；当前每节最多一张图）
4. 章节顺序要符合学术逻辑
5. 输出 **严格的 JSON 格式**，不要输出任何其他文字

**JSON 格式**：
{
  "sections": [
    {
      "title": "Introduction",
      "description": "Introduce the research background and problem definition",
      "importance": 5,
      "plannedFigureCount": 1
    },
    {
      "title": "Methods",
      "description": "Describe the experimental methods and procedures",
      "importance": 4,
      "plannedFigureCount": 2
    }
    // ... 更多章节
  ]
}

请生成章节结构：`

  try {
    const response = await completeText(settings, {
      systemPrompt: systemPrompts[paperType],
      userPrompt,
      temperature: 0.4,
      maxTokens: 2000,
    })

    // 提取 JSON（可能包含 markdown 代码块）
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('LLM 响应中未找到有效 JSON')
    }

    const jsonText = jsonMatch[0]
    const parsed = JSON.parse(jsonText) as { sections: SectionPlan[] }

    if (!parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length < 4) {
      throw new Error(`生成的章节数量不足（需要 4-8 个，实际 ${parsed.sections?.length ?? 0} 个）`)
    }

    // 限制最多8个章节
    const sections = parsed.sections.slice(0, 8)

    // 验证每个章节的字段
    for (const section of sections) {
      if (!section.title || typeof section.title !== 'string') {
        throw new Error('章节缺少有效的 title 字段')
      }
      section.description = String(section.description || '')
      section.importance = Math.max(1, Math.min(5, Number(section.importance) || 3))
      section.plannedFigureCount = Math.max(0, Math.min(1, Number(section.plannedFigureCount) || 1))
    }

    const totalPlannedFigures = sections.reduce((sum, sec) => sum + sec.plannedFigureCount, 0)

    return {
      topic,
      paperType,
      planMode: 'dynamic',
      sections,
      totalPlannedFigures,
    }
  } catch (error) {
    // 如果 LLM 生成失败，回退到固定模板
    console.error('动态结构规划失败，回退到固定模板:', error)

    const fallbackSections: Record<string, SectionPlan[]> = {
      research: [
        { title: language === 'zh' ? '引言' : 'Introduction', description: 'Research background and objectives', importance: 5, plannedFigureCount: 1 },
        { title: language === 'zh' ? '方法' : 'Methods', description: 'Research methods and procedures', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '结果' : 'Results', description: 'Experimental results and analysis', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '讨论' : 'Discussion', description: 'Discussion of results and implications', importance: 4, plannedFigureCount: 1 },
      ],
      review: [
        { title: language === 'zh' ? '引言' : 'Introduction', description: 'Review scope and significance', importance: 5, plannedFigureCount: 1 },
        { title: language === 'zh' ? '当前方法' : 'Current Approaches', description: 'Survey of existing methods', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '新兴技术' : 'Emerging Technologies', description: 'Recent developments and innovations', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '挑战与展望' : 'Challenges and Future Directions', description: 'Current challenges and future research directions', importance: 4, plannedFigureCount: 1 },
      ],
      thesis_research: [
        { title: language === 'zh' ? '引言' : 'Introduction', description: 'Detailed research background', importance: 5, plannedFigureCount: 1 },
        { title: language === 'zh' ? '文献综述' : 'Literature Review', description: 'Comprehensive literature review', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '方法' : 'Methodology', description: 'Detailed research methods', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '结果' : 'Results', description: 'Detailed experimental results', importance: 4, plannedFigureCount: 1 },
        { title: language === 'zh' ? '讨论' : 'Discussion', description: 'In-depth discussion', importance: 4, plannedFigureCount: 1 },
      ],
    }

    const sections = fallbackSections[paperType] || fallbackSections.research
    const totalPlannedFigures = sections.reduce((sum, sec) => sum + sec.plannedFigureCount, 0)

    return {
      topic,
      paperType,
      planMode: 'fixed',
      sections,
      totalPlannedFigures,
    }
  }
}
