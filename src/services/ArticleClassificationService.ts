export interface ArticleSection {
  type: string
  title: string
  start_text: string
}

export type SupportedPaperType = 'review' | 'research' | 'thesis_research'
export type SupportedLanguage = 'zh' | 'en'

export interface ArticlePromptPack {
  outlineSystemPrompt: string
  outlineRules: string[]
  titleRules: string[]
  abstractRules: string[]
  sectionPlanningFocus: string[]
  sectionWritingFocus: string[]
  transitionRules: string[]
  discussionRules: string[]
  conclusionRules: string[]
}

export interface ClassificationResult {
  articleType: string
  articleTypeLabel: string
  sections: ArticleSection[]
  standardSections: string[]
}

export interface ArticleBlueprint extends ClassificationResult {
  paperType: SupportedPaperType
  language: SupportedLanguage
  prompts: ArticlePromptPack
}

interface ArticleBlueprintSeed {
  articleType: string
  articleTypeLabel: string
  standardSections: string[]
  prompts: ArticlePromptPack
}

interface ResolveArticleBlueprintParams {
  paperType?: SupportedPaperType
  language?: SupportedLanguage
  markdown?: string
}

const ARTICLE_BLUEPRINT_SEEDS: Record<SupportedLanguage, Record<SupportedPaperType, ArticleBlueprintSeed>> = {
  zh: {
    review: {
      articleType: 'review',
      articleTypeLabel: '综述论文',
      standardSections: ['摘要', '引言', '研究脉络', '方法分类与比较', '挑战与趋势', '结论'],
      prompts: {
        outlineSystemPrompt: '你是一位资深综述论文顾问。你输出的结构必须体现文献脉络、分类框架、比较分析与趋势判断。',
        outlineRules: [
          '严格遵循综述论文组织方式，不要写成实验报告或项目总结。',
          '主体章节要覆盖研究脉络、方法分类或理论分类、比较分析、挑战与趋势。',
          '章节标题要体现归纳、综述、比较、争议、演进、趋势等综述语义。',
        ],
        titleRules: [
          '标题应突出综述、进展、脉络、分类、比较、趋势等综述属性。',
          '避免写成具体实验题目或单一结果陈述。',
        ],
        abstractRules: [
          '摘要需交代综述范围、分类维度、比较视角、主要结论和趋势判断。',
          '不要伪造实验数据或把摘要写成原创实验结果。',
        ],
        sectionPlanningFocus: [
          '优先思考如何归纳文献谱系、主题分支、方法类别和关键争议。',
          '强调章节之间的综述逻辑推进，而不是实验流程推进。',
        ],
        sectionWritingFocus: [
          '正文要以综合梳理、比较分析、优缺点评述和趋势总结为主。',
          '避免虚构实验、样本、数据表述。',
        ],
        transitionRules: [
          '过渡段要体现从一个综述维度切到下一个综述维度的逻辑。',
          '优先总结上一节发现，再引出新的分类或争议。',
        ],
        discussionRules: [
          '讨论聚焦领域共识、争议、局限、空白与未来演进方向。',
        ],
        conclusionRules: [
          '结论要回收综述主线，概括分类框架、阶段判断和研究前景。',
        ],
      },
    },
    research: {
      articleType: 'research',
      articleTypeLabel: '研究论文',
      standardSections: ['摘要', '引言', '实验设备', '实验结果分析', '理论分析', '结论'],
      prompts: {
        outlineSystemPrompt: '你是一位资深实验研究论文顾问。你输出的结构必须体现研究背景、实验设计、结果分析与理论解释这条完整证据链。',
        outlineRules: [
          '严格遵循实验研究论文组织方式，不要写成综述、行业报告或泛泛介绍。',
          '主体章节应围绕引言、实验设备、实验结果分析、理论分析这四类核心内容展开。',
          '章节标题要体现实验流程和证据链，而不是综述式分类。',
        ],
        titleRules: [
          '标题应突出研究对象、实验路径、方法或主要贡献。',
          '避免使用“综述”“进展”“脉络”等综述型表述。',
        ],
        abstractRules: [
          '摘要需包含研究目标、实验设置、关键结果、理论解释和贡献。',
          '摘要要体现原创实验研究而不是文献归纳。',
        ],
        sectionPlanningFocus: [
          '优先梳理研究背景、实验条件、数据证据、理论机制和验证链条。',
          '每节都要服务于提出问题、说明实验、展示结果、解释机制。',
        ],
        sectionWritingFocus: [
          '正文要强调实验设置可复现、结果分析有证据支撑、理论分析与实验观察相互印证。',
          '避免把章节写成纯文献罗列、空泛讨论或综述式归纳。',
        ],
        transitionRules: [
          '过渡段要体现研究链条推进，如从背景到实验设计、从实验到结果、从结果到理论解释。',
        ],
        discussionRules: [
          '讨论要聚焦结果解释、机制分析、边界条件、误差来源和适用范围。',
        ],
        conclusionRules: [
          '结论要明确总结实验发现、理论解释、方法贡献与后续工作。',
        ],
      },
    },
    thesis_research: {
      articleType: 'thesis_research',
      articleTypeLabel: '学位论文',
      standardSections: ['摘要', '引言', '相关研究', '理论基础与研究问题', '研究设计', '结果分析', '结论'],
      prompts: {
        outlineSystemPrompt: '你是一位资深学位论文顾问。你输出的结构必须兼顾文献综述、理论基础、研究设计与学术规范。',
        outlineRules: [
          '严格遵循学位论文组织方式，兼顾综述深度、理论基础、方法设计和结果分析。',
          '主体章节要体现相关研究、理论基础或研究问题、研究设计、结果分析。',
          '章节标题要稳健、规范、书面化，符合学位论文表达习惯。',
        ],
        titleRules: [
          '标题应稳健正式，突出研究对象、问题域与方法路径。',
          '保持学位论文风格，不要过度营销化或口号化。',
        ],
        abstractRules: [
          '摘要需包含研究背景、研究问题、方法路径、主要发现与学术意义。',
          '保持规范的学位论文摘要风格。',
        ],
        sectionPlanningFocus: [
          '优先考虑理论基础铺垫、文献综述承接、研究问题展开和分析深度。',
          '章节之间要体现完整学术论证链。',
        ],
        sectionWritingFocus: [
          '正文要兼顾规范性、系统性与论证完整性。',
          '既不能过于综述化，也不能只剩实验报告。',
        ],
        transitionRules: [
          '过渡段要体现论文整体论证进度，如从文献基础过渡到问题提出，再到设计与分析。',
        ],
        discussionRules: [
          '讨论要强调结果解释、理论联系、实践意义与研究局限。',
        ],
        conclusionRules: [
          '结论要总结研究主线、主要发现、理论与实践价值，并指出后续研究方向。',
        ],
      },
    },
  },
  en: {
    review: {
      articleType: 'review',
      articleTypeLabel: 'Review Article',
      standardSections: ['Abstract', 'Introduction', 'Research Landscape', 'Method Taxonomy and Comparison', 'Challenges and Trends', 'Conclusion'],
      prompts: {
        outlineSystemPrompt: 'You are a senior review-article advisor. The structure must foreground literature evolution, taxonomy, comparison, controversies, and trends.',
        outlineRules: [
          'Use a review-paper structure rather than an experimental report.',
          'Core sections must cover landscape, taxonomy or comparison, and challenges or trends.',
          'Section titles should signal synthesis, comparison, debate, and trend analysis.',
        ],
        titleRules: [
          'The title should clearly read as a review, survey, synthesis, or trend analysis.',
          'Avoid framing the paper as a single original experiment.',
        ],
        abstractRules: [
          'The abstract should state scope, comparison dimensions, synthesis strategy, major findings, and future trends.',
          'Do not fabricate experimental findings as if this were an original study.',
        ],
        sectionPlanningFocus: [
          'Focus on literature lineage, thematic branches, taxonomy, comparison criteria, and unresolved debates.',
        ],
        sectionWritingFocus: [
          'Write as a synthesis-and-comparison paper rather than as an experiment report.',
        ],
        transitionRules: [
          'Transitions should connect one synthesis dimension to the next.',
        ],
        discussionRules: [
          'Discussion should synthesize consensus, controversies, limitations, and future directions of the field.',
        ],
        conclusionRules: [
          'Conclusion should summarize the review framework, major takeaways, and future outlook.',
        ],
      },
    },
    research: {
      articleType: 'research',
      articleTypeLabel: 'Research Article',
      standardSections: ['Abstract', 'Introduction', 'Experimental Equipment', 'Experimental Results Analysis', 'Theoretical Analysis', 'Conclusion'],
      prompts: {
        outlineSystemPrompt: 'You are a senior experimental-research-paper advisor. The structure must foreground the research background, experimental setup, empirical evidence, and theoretical explanation.',
        outlineRules: [
          'Use an experimental research-paper structure rather than a survey or generic report.',
          'Core sections should cover introduction, experimental equipment or setup, experimental results analysis, and theoretical analysis.',
          'Section titles should emphasize experimental workflow, evidence, and mechanism explanation.',
        ],
        titleRules: [
          'The title should foreground the research object, experimental path, method, or contribution.',
          'Avoid review-style wording such as survey, overview, or trends unless explicitly required.',
        ],
        abstractRules: [
          'The abstract should cover objective, experimental setup, key findings, theoretical explanation, and contribution.',
        ],
        sectionPlanningFocus: [
          'Focus on research background, experimental conditions, data evidence, mechanism interpretation, and the evidence chain.',
        ],
        sectionWritingFocus: [
          'Write with experimental clarity, reproducibility, evidence-based analysis, and theory-to-evidence alignment.',
        ],
        transitionRules: [
          'Transitions should move the reader from background to setup to evidence to theoretical interpretation.',
        ],
        discussionRules: [
          'Discussion should interpret findings, analyze mechanisms, and clarify limitations and boundary conditions.',
        ],
        conclusionRules: [
          'Conclusion should summarize findings, theoretical explanation, validated contributions, and next steps.',
        ],
      },
    },
    thesis_research: {
      articleType: 'thesis_research',
      articleTypeLabel: 'Thesis Research',
      standardSections: ['Abstract', 'Introduction', 'Related Work', 'Theoretical Foundation and Research Questions', 'Research Design', 'Results Analysis', 'Conclusion'],
      prompts: {
        outlineSystemPrompt: 'You are a senior thesis advisor. The structure must balance literature review, theoretical grounding, method design, and academically rigorous analysis.',
        outlineRules: [
          'Use a thesis-style structure with explicit related work, theoretical grounding, method design, and results analysis.',
          'Section titles should be formal, stable, and academically appropriate.',
        ],
        titleRules: [
          'The title should be formal and thesis-appropriate, foregrounding the research object and method path.',
        ],
        abstractRules: [
          'The abstract should cover background, problem, method path, major findings, and academic significance.',
        ],
        sectionPlanningFocus: [
          'Focus on theoretical grounding, literature positioning, problem framing, and analytical completeness.',
        ],
        sectionWritingFocus: [
          'Write with thesis-level rigor, systematic exposition, and complete argumentation.',
        ],
        transitionRules: [
          'Transitions should reflect the thesis argument flow from literature and theory to design and analysis.',
        ],
        discussionRules: [
          'Discussion should connect findings back to theory, implications, and limitations.',
        ],
        conclusionRules: [
          'Conclusion should summarize the thesis argument, findings, significance, and future work.',
        ],
      },
    },
  },
}

function normalizePaperType(paperType?: string): SupportedPaperType {
  if (paperType === 'research' || paperType === 'thesis_research') return paperType
  return 'review'
}

function normalizeLanguage(language?: string): SupportedLanguage {
  return language === 'en' ? 'en' : 'zh'
}

function normalizeSectionType(title: string): string {
  const normalized = String(title || '').trim().toLowerCase()
  if (!normalized) return 'paragraph'
  if (normalized.includes('摘要') || normalized.includes('abstract')) return 'abstract'
  if (normalized.includes('引言') || normalized.includes('introduction')) return 'introduction'
  if (normalized.includes('实验设备') || normalized.includes('equipment')) return 'methodology'
  if (normalized.includes('相关研究') || normalized.includes('related work')) return 'related_work'
  if (normalized.includes('理论') || normalized.includes('theoretical')) return 'theory'
  if (normalized.includes('研究问题') || normalized.includes('hypoth')) return 'research_question'
  if (normalized.includes('实验结果分析') || normalized.includes('results analysis')) return 'results'
  if (normalized.includes('研究设计') || normalized.includes('method') || normalized.includes('design')) return 'methodology'
  if (normalized.includes('结果') || normalized.includes('result')) return 'results'
  if (normalized.includes('讨论') || normalized.includes('discussion')) return 'discussion'
  if (normalized.includes('挑战') || normalized.includes('趋势') || normalized.includes('trend')) return 'trend_analysis'
  if (normalized.includes('分类') || normalized.includes('taxonomy') || normalized.includes('比较') || normalized.includes('comparison')) return 'taxonomy'
  if (normalized.includes('脉络') || normalized.includes('landscape')) return 'landscape'
  if (normalized.includes('结论') || normalized.includes('conclusion')) return 'conclusion'
  return normalized.replace(/\s+/g, '_')
}

function buildSectionsFromMarkdown(markdown: string, fallbackSections: string[]): ArticleSection[] {
  const source = String(markdown || '')
  const headingMatches = Array.from(source.matchAll(/^#{1,3}\s+(.+)$/gm)).map((match) => String(match[1] || '').trim()).filter(Boolean)
  const titles = headingMatches.length > 0 ? headingMatches : fallbackSections
  return titles.map((title) => ({
    type: normalizeSectionType(title),
    title,
    start_text: title,
  }))
}

export function resolveArticleBlueprint(params: ResolveArticleBlueprintParams = {}): ArticleBlueprint {
  const language = normalizeLanguage(params.language)
  const paperType = normalizePaperType(params.paperType)
  const seed = ARTICLE_BLUEPRINT_SEEDS[language][paperType]
  const sections = buildSectionsFromMarkdown(params.markdown || '', seed.standardSections)
  return {
    paperType,
    language,
    articleType: seed.articleType,
    articleTypeLabel: seed.articleTypeLabel,
    sections,
    standardSections: [...seed.standardSections],
    prompts: seed.prompts,
  }
}

export async function classifyArticle(params: ResolveArticleBlueprintParams = {}): Promise<ClassificationResult | null> {
  const { prompts: _prompts, ...result } = resolveArticleBlueprint(params)
  return result
}

export function detectSectionType(paragraphText: string, fullText: string, sections: ArticleSection[]): string {
  if (!sections.length || !fullText) return ''
  const paraPos = fullText.indexOf(paragraphText.slice(0, 60))
  if (paraPos === -1) return ''
  let bestSection = ''
  let bestPos = -1
  for (const sec of sections) {
    if (!sec.start_text) continue
    const secPos = fullText.indexOf(sec.start_text.slice(0, 30))
    if (secPos !== -1 && secPos <= paraPos && secPos > bestPos) {
      bestPos = secPos
      bestSection = sec.type
    }
  }
  return bestSection
}