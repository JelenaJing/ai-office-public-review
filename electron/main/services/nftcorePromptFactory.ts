import type { SectionPlan } from './paperStructurePlanner'

export type NFTCOREPaperType = 'review' | 'research' | 'thesis_research'
export type NFTCORELanguage = 'zh' | 'en'

export interface PromptSpec {
  systemPrompt: string
  userPrompt: string
}

export type CitationMode = 'deferred' | 'inline'

interface PromptContext {
  topic: string
  language: NFTCORELanguage
  paperType: NFTCOREPaperType
  extraContext?: string
}

interface StructureThinkingContext extends PromptContext {
  sections: SectionPlan[]
}

interface TitleAbstractContext extends PromptContext {
  sections: SectionPlan[]
}

interface SectionContext extends PromptContext {
  sectionPlan: SectionPlan
  previousMarkdown: string
  title?: string
  citationMode?: CitationMode
  referenceContext?: string
}

interface ConclusionContext extends PromptContext {
  previousMarkdown: string
  title: string
  citationMode?: CitationMode
  referenceContext?: string
}

export interface TitleAbstractResult {
  title: string
  abstract: string
}

interface ResearchSectionTemplate {
  thinkingPromptTemplate: string
  contentPromptTemplate: string
}

const REVIEW_EXPERT_ROLE = 'professional academic literature review expert'
const RESEARCH_EXPERT_ROLE = 'professional academic paper writer'
const RESEARCH_THINKING_ROLE = 'academic expert that generates deep, scholarly thinking processes'

const RESEARCH_SECTION_TEMPLATES: Record<string, ResearchSectionTemplate> = {
  introduction: {
    thinkingPromptTemplate: `Based on the following context, generate a deep, academic thinking process (5-7 sentences) about what will be generated for the Introduction section.

Context:
Topic: {topic}
Previous content: {previous_content}

Next action: Write the Introduction section, which should cover:
1. Research background and context
2. Problem statement and research significance
3. Literature review and current state of the field
4. Research objectives and scope

Requirements:
1. Write 5-7 sentences providing a comprehensive, in-depth analysis
2. Analyze the research background from multiple dimensions: theoretical foundations, practical needs, and gaps in current knowledge
3. Explain why this research is important and what problems it addresses
4. Consider the logical flow from general background to specific research questions
5. Use academic writing style with precise terminology
6. Be substantive and insightful - avoid redundancy or obvious statements
7. Each sentence should contribute unique value to the analysis

Please generate only the thinking content, without any additional explanation:`,
    contentPromptTemplate: `Write the Introduction section for an experimental research paper.

Topic: {topic}
Paper Title: {paper_title}

Previous sections:
{previous_content}

Requirements:
1. Start with the research background and context (2-3 paragraphs)
2. Clearly state the problem and research significance (1-2 paragraphs)
3. Provide a comprehensive literature review covering relevant previous work (3-4 paragraphs)
4. State the research objectives and scope of this study (1 paragraph)
5. Use academic writing style with proper citations
6. The total length should be approximately 800-1200 words
7. Ensure logical flow from general to specific

Please write the Introduction section content in English, without any markdown formatting or section headers:`,
  },
  experimental_equipment: {
    thinkingPromptTemplate: `Based on the following context, generate a deep, academic thinking process (5-7 sentences) about what will be generated for the Experimental Equipment section.

Context:
Topic: {topic}
Previous content: {previous_content}

Next action: Write the Experimental Equipment section, which should cover:
1. Equipment selection rationale and specifications
2. Experimental setup and configuration
3. Experimental conditions and parameters
4. Methodology and procedures

Requirements:
1. Write 5-7 sentences providing a comprehensive, in-depth analysis
2. Analyze the equipment selection from multiple dimensions: technical requirements, measurement capabilities, and experimental design logic
3. Explain why specific equipment was chosen and how it addresses the research needs
4. Consider the relationship between equipment capabilities and experimental objectives
5. Use academic writing style with precise technical terminology
6. Be substantive and insightful - avoid redundancy or obvious statements
7. Each sentence should contribute unique value to the analysis

Please generate only the thinking content, without any additional explanation:`,
    contentPromptTemplate: `Write the Experimental Equipment section for an experimental research paper.

Topic: {topic}
Paper Title: {paper_title}

Previous sections:
{previous_content}

Requirements:
1. Describe the experimental equipment and instruments used (2-3 paragraphs)
2. Provide detailed specifications and technical parameters (1-2 paragraphs)
3. Explain the experimental setup and configuration (1-2 paragraphs)
4. Describe the experimental conditions, including temperature, pressure, atmosphere, etc. (1-2 paragraphs)
5. Detail the experimental procedures and methodology (2-3 paragraphs)
6. Use academic writing style with proper technical terminology
7. The total length should be approximately 600-900 words
8. Ensure clarity and reproducibility

Please write the Experimental Equipment section content in English, without any markdown formatting or section headers:`,
  },
  experimental_results_analysis: {
    thinkingPromptTemplate: `Based on the following context, generate a deep, academic thinking process (5-7 sentences) about what will be generated for the Experimental Results Analysis section.

Context:
Topic: {topic}
Previous content: {previous_content}

Next action: Write the Experimental Results Analysis section, which should cover:
1. Data presentation and key findings
2. Result interpretation and discussion
3. Trend analysis and pattern recognition
4. Comparison with previous studies or theoretical predictions

Requirements:
1. Write 5-7 sentences providing a comprehensive, in-depth analysis
2. Analyze the data interpretation logic from multiple dimensions: statistical significance, physical meaning, and experimental validation
3. Explain how the results relate to the research objectives and what insights they provide
4. Consider the relationships between different experimental results and their implications
5. Use academic writing style with precise analytical terminology
6. Be substantive and insightful - avoid redundancy or obvious statements
7. Each sentence should contribute unique value to the analysis

Please generate only the thinking content, without any additional explanation:`,
    contentPromptTemplate: `Write the Experimental Results Analysis section for an experimental research paper.

Topic: {topic}
Paper Title: {paper_title}

Previous sections:
{previous_content}

Requirements:
1. Present the experimental data and key findings systematically (3-4 paragraphs)
2. Provide detailed analysis and interpretation of the results (3-4 paragraphs)
3. Discuss trends, patterns, and relationships observed in the data (2-3 paragraphs)
4. Compare results with previous studies or theoretical predictions (1-2 paragraphs)
5. Highlight significant findings and their implications (1-2 paragraphs)
6. Use academic writing style with proper data presentation
7. The total length should be approximately 1000-1400 words
8. Ensure logical organization and clear presentation

Please write the Experimental Results Analysis section content in English, without any markdown formatting or section headers:`,
  },
  theoretical_analysis: {
    thinkingPromptTemplate: `Based on the following context, generate a deep, academic thinking process (5-7 sentences) about what will be generated for the Theoretical Analysis section.

Context:
Topic: {topic}
Previous content: {previous_content}

Next action: Write the Theoretical Analysis section, which should cover:
1. Theoretical framework and models
2. Mechanism explanation and analysis
3. Theoretical validation against experimental results
4. Theoretical predictions and implications

Requirements:
1. Write 5-7 sentences providing a comprehensive, in-depth analysis
2. Analyze the theoretical framework from multiple dimensions: model assumptions, mathematical formulations, and physical mechanisms
3. Explain how the theory connects to the experimental observations and what insights it provides
4. Consider the relationship between theoretical predictions and experimental validation
5. Use academic writing style with precise theoretical terminology
6. Be substantive and insightful - avoid redundancy or obvious statements
7. Each sentence should contribute unique value to the analysis

Please generate only the thinking content, without any additional explanation:`,
    contentPromptTemplate: `Write the Theoretical Analysis section for an experimental research paper.

Topic: {topic}
Paper Title: {paper_title}

Previous sections:
{previous_content}

Requirements:
1. Present the theoretical framework and models used (2-3 paragraphs)
2. Explain the underlying mechanisms and physical processes (2-3 paragraphs)
3. Analyze the theoretical predictions and their relationship to experimental results (2-3 paragraphs)
4. Discuss theoretical validation and agreement with experimental data (1-2 paragraphs)
5. Explore theoretical implications and future directions (1-2 paragraphs)
6. Use academic writing style with proper theoretical terminology
7. The total length should be approximately 800-1200 words
8. Ensure logical flow from theory to validation

Please write the Theoretical Analysis section content in English, without any markdown formatting or section headers:`,
  },
}

function buildEnrichedTopic(topic: string, extraContext?: string): string {
  const trimmedExtra = String(extraContext || '').trim()
  if (!trimmedExtra) return topic
  return `${topic}\n\n${trimmedExtra}`
}

function buildLanguageInstruction(language: NFTCORELanguage): string {
  return language === 'zh'
    ? '必须全程使用简体中文（Simplified Chinese）撰写，绝对不能出现英文句子。'
    : 'Write ONLY in English, never in Chinese or any other language.'
}

function buildLanguageInstructionShort(language: NFTCORELanguage): string {
  return language === 'zh'
    ? 'Write the paper entirely in Simplified Chinese (简体中文). All content including title, abstract, sections and conclusion must be in Chinese.'
    : 'Write ONLY in English.'
}

function buildResearchSectionKey(title: string): keyof typeof RESEARCH_SECTION_TEMPLATES {
  const normalized = String(title || '').trim().toLowerCase()
  if (normalized.includes('experimental equipment') || normalized.includes('实验设备')) return 'experimental_equipment'
  if (normalized.includes('experimental results analysis') || normalized.includes('实验结果分析')) return 'experimental_results_analysis'
  if (normalized.includes('theoretical analysis') || normalized.includes('理论分析')) return 'theoretical_analysis'
  return 'introduction'
}

function buildCitationRules(language: NFTCORELanguage, citationMode: CitationMode, referenceContext?: string): string {
  if (citationMode !== 'inline') {
    return language === 'zh'
      ? '不要使用任何 [1]、[2,3] 之类的引文格式。本阶段先专注写作，参考文献后续再统一整理。'
      : 'Do NOT use citation markers like [1], [2, 3], or [4-6]. Draft the prose first; references will be organized later.'
  }

  const referenceBlock = String(referenceContext || '').trim()
  const baseRule = language === 'zh'
    ? '在正文中直接使用数字引用格式，如 [1]、[2, 3]。是否引用、引用几个、引用哪些文献，必须由你根据当前句子的证据强度自行判断。不要为了凑数量机械加引；没有明确文献支撑时可以不引。但对重要事实、定义、方法、实验现象、对比结论和具体数据，应尽量选择最匹配的候选文献提供支撑，并优先覆盖不同关键论断。单句通常使用 0-2 个引用即可。只允许使用下方候选文献中的编号，不要编造不存在的编号。'
    : 'Use inline numeric citations such as [1] and [2, 3] directly in the prose. You must decide claim by claim whether to cite, how many citations to use, and which candidate references best support the statement. Do not add citations mechanically to satisfy a quota; leave a sentence uncited when no candidate reference clearly supports it. For important facts, definitions, methods, comparisons, experimental findings, and concrete data, try to support the claim with the best-matched candidate references and cover distinct key claims broadly rather than reusing only a few papers. Usually 0-2 citations per sentence are enough. Only use citation numbers from the candidate references below; never invent citation numbers.'

  if (!referenceBlock) return baseRule
  return `${baseRule}\n\n${language === 'zh' ? '候选参考文献：' : 'Candidate references:'}\n${referenceBlock}`
}

export function buildStructureThinkingPrompt(context: StructureThinkingContext): PromptSpec {
  if (context.paperType === 'research') {
    return {
      systemPrompt: `You are an ${RESEARCH_THINKING_ROLE}. You write comprehensive analyses in 5-7 sentences using academic writing style. ${buildLanguageInstruction(context.language)}`,
      userPrompt: `Based on the topic provided, analyze the structure for an experimental research paper.\n\nTopic: ${buildEnrichedTopic(context.topic, context.extraContext)}\n\nThis experimental paper will have ${context.sections.length} fixed sections:\n${context.sections.map((section, index) => `${index + 1}. ${section.title} - ${section.description}`).join('\n')}\n\nGenerate a brief thinking process (5-7 sentences) about how these sections will be organized and what key elements each section should cover.\n\nPlease generate only the thinking content, without any additional explanation:`,
    }
  }

  const totalSentences = context.sections.length + 2
  const inputContext = `topic '${context.topic}'`
  const sectionLines = context.sections.map((section, index) => `${index + 2}. Sentence ${index + 2}: Describe what content should be included in the "${section.title}" section (${section.description}).`)

  return {
    systemPrompt: `You are an academic literature review expert. You analyze topics and plan the structure of literature review papers. The structure follows: ${context.sections.map((section) => section.title).join(' → ')}. Write in a natural, thinking style as ONE continuous paragraph with exactly ${totalSentences} sentences, without line breaks, bullet points, or markdown formatting. ${buildLanguageInstruction(context.language)}`,
    userPrompt: `Based on the received input: topic/description: ${context.topic}, I will construct a literature review structure based on the topic ${JSON.stringify(buildEnrichedTopic(context.topic, context.extraContext))}.\n\nPlease provide a natural paragraph description in the following format:\n1. First sentence: Introduction stating that you will construct a literature review structure based on ${inputContext}.\n${sectionLines.join('\n')}\n${totalSentences}. Sentence ${totalSentences}: A concluding sentence that summarizes the overall structure.\n\nIMPORTANT: Write all ${totalSentences} sentences in ONE continuous paragraph without line breaks or bullet points. Use natural transitions between sentences. Do not use markdown formatting, bullet points, or numbered lists.`,
  }
}

export function buildTitleAbstractPrompt(context: TitleAbstractContext): PromptSpec {
  if (context.paperType === 'research') {
    return {
      systemPrompt: `You are a ${RESEARCH_EXPERT_ROLE}. You write clear titles and comprehensive abstracts for experimental research papers. When writing the title, use markdown format # followed directly by the title text (do NOT include 'Title:' or any label). Then write ## Abstract followed by the abstract content. Do NOT use any citation format in the abstract. IMPORTANT: ${buildLanguageInstructionShort(context.language)}`,
      userPrompt: `Generate a title and abstract for an experimental research paper on the topic: ${buildEnrichedTopic(context.topic, context.extraContext)}\n\nRequirements:\n1. Title should be clear and concise, reflecting the experimental nature of the research\n2. Abstract should be 150-250 words, summarizing the research objectives, methods, key findings, and implications\n3. Use markdown format: Start with # followed by the title (the title itself, NOT "Title:" or any label), then ## Abstract\n4. IMPORTANT: Do NOT include "Title:" or any label before the title. Just write the title directly after #.\n5. IMPORTANT: Do NOT use any citation format like [1], [2, 3] in the abstract. Write the abstract without any references or citations.\n\nExample format:\n# Enhanced Stability and Efficiency of Perovskite Solar Cells\n## Abstract\n[abstract content here...]\n\nPlease generate only the title and abstract:`,
    }
  }

  return {
    systemPrompt: `You are a ${REVIEW_EXPERT_ROLE}. You write clear titles and comprehensive abstracts for academic papers. Do NOT use any citation format in the abstract. Write the abstract without references or citations. IMPORTANT: ${buildLanguageInstructionShort(context.language)}`,
    userPrompt: `Generate a title and abstract for a literature review paper on the topic: ${buildEnrichedTopic(context.topic, context.extraContext)}\n\nRequirements:\n1. Title should be clear and concise\n2. Abstract should be 100-200 words, summarizing the key aspects of the topic\n3. Use markdown format with # Title and ## Abstract\n4. IMPORTANT: Do NOT use any citation format like [1], [2, 3] in the abstract. Write the abstract without any references or citations.\n5. ${context.language === 'zh' ? 'Write entirely in Simplified Chinese (简体中文).' : 'Write ONLY in English.'}\n\nPlease generate only the title and abstract:`,
  }
}

export function buildSectionThinkingPrompt(context: SectionContext): PromptSpec {
  if (context.paperType === 'research') {
    const template = RESEARCH_SECTION_TEMPLATES[buildResearchSectionKey(context.sectionPlan.title)]
    return {
      systemPrompt: `You are an ${RESEARCH_THINKING_ROLE}. You write comprehensive, insightful analyses in 5-7 sentences using academic writing style. ${buildLanguageInstruction(context.language)}`,
      userPrompt: template.thinkingPromptTemplate
        .replace('{topic}', buildEnrichedTopic(context.topic, context.extraContext))
        .replace('{previous_content}', (context.previousMarkdown || '').slice(-2200)),
    }
  }

  if (context.language === 'zh') {
    return {
      systemPrompt: `You are an academic expert that generates deep, scholarly thinking processes before generating content. You write comprehensive, insightful analyses in 5-7 sentences using academic writing style. Your thinking demonstrates sophisticated understanding, multi-dimensional analysis, and precise reasoning without redundancy. IMPORTANT: ${buildLanguageInstruction(context.language)}`,
      userPrompt: `根据以下上下文，用简体中文生成深度学术思考过程（5-7句话），分析接下来将要生成的内容。\n\n上下文：\nTopic: ${buildEnrichedTopic(context.topic, context.extraContext)}\n\nAll previous content:\n${(context.previousMarkdown || 'Title and abstract have been generated.').slice(-2200)}\n\n接下来的操作：Write the "${context.sectionPlan.title}" section: ${context.sectionPlan.description}\n\n要求：\n1. 用简体中文写5-7句话，对思考过程进行全面深入的分析\n2. 从多个维度分析：理论基础、方法论考量、逻辑连接和策略方法\n3. 不仅说明将要生成什么，还要解释为什么这种方法合适，需要解决哪些关键要素，以及如何与更广泛的学术话语联系\n4. 使用学术写作风格，精确术语和严谨推理\n5. 实质性且有见地，避免冗余、填充词或显而易见的陈述\n6. 每句话都应为分析贡献独特价值\n7. 保持反映对主题深刻理解的学术语调\n\n仅生成思考内容，不需要额外解释：`,
    }
  }

  return {
    systemPrompt: `You are an academic expert that generates deep, scholarly thinking processes before generating content. You write comprehensive, insightful analyses in 5-7 sentences using academic writing style. Your thinking demonstrates sophisticated understanding, multi-dimensional analysis, and precise reasoning without redundancy. IMPORTANT: ${buildLanguageInstruction(context.language)}`,
    userPrompt: `Based on the following context, generate a deep, academic thinking process (5-7 sentences) about what will be generated next.\n\nContext:\nTopic: ${buildEnrichedTopic(context.topic, context.extraContext)}\n\nAll previous content:\n${(context.previousMarkdown || 'Title and abstract have been generated.').slice(-2200)}\n\nNext action: Write the "${context.sectionPlan.title}" section: ${context.sectionPlan.description}\n\nRequirements:\n1. Write 5-7 sentences providing a comprehensive, in-depth analysis of the thinking process\n2. Analyze the context from multiple dimensions: theoretical foundations, methodological considerations, logical connections, and strategic approach\n3. Explain not only what will be generated, but also why this approach is appropriate, what key elements must be addressed, and how it connects to the broader academic discourse\n4. Use academic writing style with precise terminology and sophisticated reasoning\n5. Be substantive and insightful - avoid redundancy, filler words, or obvious statements\n6. Each sentence should contribute unique value to the analysis\n7. Maintain a scholarly tone that reflects deep understanding of the subject matter\n\nPlease generate only the thinking content, without any additional explanation:`,
  }
}

export function buildSectionContentPrompt(context: SectionContext): PromptSpec {
  const citationMode = context.citationMode || 'deferred'
  const citationRules = buildCitationRules(context.language, citationMode, context.referenceContext)

  if (context.paperType === 'research') {
    const template = RESEARCH_SECTION_TEMPLATES[buildResearchSectionKey(context.sectionPlan.title)]
    return {
      systemPrompt: `You are a ${RESEARCH_EXPERT_ROLE}. You write clear, well-structured content for experimental research papers. ${buildLanguageInstruction(context.language)}\n\nCitation rules:\n${citationRules}`,
      userPrompt: `${template.contentPromptTemplate
        .replace('{topic}', buildEnrichedTopic(context.topic, context.extraContext))
        .replace('{paper_title}', context.title || context.topic)
        .replace('{previous_content}', (context.previousMarkdown || '').slice(-2600))}\n\n${citationRules}`,
    }
  }

  const paperLabel = context.paperType === 'thesis_research' ? 'academic thesis paper' : 'literature review paper'
  const expertRole = context.paperType === 'thesis_research' ? 'academic thesis paper writing expert' : REVIEW_EXPERT_ROLE
  const citationModeLine = citationMode === 'inline'
    ? '3. MOST IMPORTANT: Decide yourself whether a sentence needs citation support. Use inline numeric citations like [1] and [2, 3] only when a claim materially benefits from evidence. Do not cite every paragraph mechanically, and only cite candidate references that are provided below.'
    : '3. MOST IMPORTANT: Do NOT use any citation format like [1], [2, 3], [4-6] in your writing. Write the content without any references or citations. References will be added later in a separate step.'
  const draftModeLine = citationMode === 'inline'
    ? 'As an academic expert, integrate citations naturally while preserving section coherence and readability. Citation density should follow the substance of the paragraph, but important claims that rely on prior work should be supported rather than left systematically uncited.'
    : 'As an academic expert, you understand that this is a draft version where references will be added later. Focus on writing high-quality content that clearly presents the ideas and concepts.'
  const promptReferenceBlock = context.referenceContext?.trim()
    ? `\n\nCandidate references for citation numbering:\n${context.referenceContext.trim()}`
    : ''
  return {
    systemPrompt: `You are a ${expertRole}. You write well-structured, comprehensive sections for ${paperLabel}s using markdown format.\n\nCRITICAL Writing Rules:\n1. You MUST use the exact section heading specified in the prompt\n2. ${buildLanguageInstruction(context.language)}\n${citationModeLine}\n4. Write naturally and comprehensively, focusing on the content and ideas rather than formulaic padding\n\n${draftModeLine}`,
    userPrompt: `Based on the topic "${context.topic}", write the "${context.sectionPlan.title}" section of a ${paperLabel}.\n\nAll previous content already written (including title, abstract, and all previous sections):\n${context.previousMarkdown || 'This is the first section after title and abstract.'}\n\nThe "${context.sectionPlan.title}" section should focus on:\n${context.sectionPlan.description}${promptReferenceBlock}\n\nIMPORTANT - Writing Requirements:\n1. Write comprehensive content (approximately 750 words, organized in 2-3 paragraphs, with at least 2 paragraphs)\n2. Use markdown format with the heading: ## ${context.sectionPlan.title}\n3. The section MUST start with the heading "## ${context.sectionPlan.title}" (exactly as specified)\n4. Do NOT include image placeholders like [FIGURE:...]\n5. Focus on the specific aspect of this section\n6. Ensure the content flows naturally from previous sections\n7. ${citationMode === 'inline' ? 'Add inline numeric citations where support is genuinely needed. Use candidate references to cover important factual, methodological, comparative, and data-driven claims, and avoid leaving major supported claims systematically uncited; however, do not force low-relevance citations just to chase a quota.' : 'Do NOT use any citation format like [1], [2, 3], [4-6] in this section. Write the content without any references or citations. References will be added later.'}\n\nPlease generate the "${context.sectionPlan.title}" section:`,
  }
}

export function buildConclusionPrompt(context: ConclusionContext): PromptSpec {
  const citationMode = context.citationMode || 'deferred'
  const promptReferenceBlock = context.referenceContext?.trim()
    ? `\n\nCandidate references for citation numbering:\n${context.referenceContext.trim()}`
    : ''
  if (context.paperType === 'research') {
    return {
      systemPrompt: `You are a ${RESEARCH_EXPERT_ROLE}. You write clear, well-structured conclusion sections for experimental research papers. ${buildLanguageInstructionShort(context.language)}\n\nCitation rules:\n${buildCitationRules(context.language, citationMode, context.referenceContext)}`,
      userPrompt: `Write a conclusion section for an experimental research paper.\n\nTopic: ${buildEnrichedTopic(context.topic, context.extraContext)}\nPaper Title: ${context.title}\n\nPrevious sections:\n${context.previousMarkdown.slice(-2000)}${promptReferenceBlock}\n\nRequirements:\n1. Summarize the key findings from the experimental results (1-2 paragraphs)\n2. Discuss the theoretical implications and significance (1-2 paragraphs)\n3. Highlight the contributions and limitations of the research (1 paragraph)\n4. Suggest future research directions (1 paragraph)\n5. Use academic writing style\n6. The total length should be approximately 300-500 words\n7. Use markdown format with ## ${context.language === 'zh' ? '结论' : 'Conclusion'}\n8. ${citationMode === 'inline' ? 'Use inline numeric citations for concluding claims that clearly rely on prior work, comparative findings, or established evidence. Keep citations selective, but do not omit obvious support for major claims.' : 'Do not use citations in the conclusion.'}\n\nPlease write the conclusion section ${context.language === 'zh' ? 'in Simplified Chinese' : 'in English'}, without any markdown formatting except the header:`,
    }
  }

  return {
    systemPrompt: `You are a ${REVIEW_EXPERT_ROLE}. You write comprehensive conclusion sections that summarize key findings, highlight achievements, discuss challenges, and provide future perspectives. IMPORTANT: ${buildLanguageInstructionShort(context.language)}\n\nCitation rules:\n${buildCitationRules(context.language, citationMode, context.referenceContext)}`,
    userPrompt: `Based on the following literature review sections, write a comprehensive conclusion section.\n\nTopic: ${buildEnrichedTopic(context.topic, context.extraContext)}\n\nPrevious sections:\n${context.previousMarkdown.slice(-2000)}...${promptReferenceBlock}\n\nRequirements:\n1. Summarize the key findings from the literature review\n2. Highlight the main contributions and achievements in the field\n3. Discuss current challenges and research gaps\n4. Provide future perspectives and directions\n5. Use markdown format with ## ${context.language === 'zh' ? '结论' : 'Conclusion'}\n6. Length: 200-300 words\n7. ${citationMode === 'inline' ? 'Use inline numeric citations when they directly strengthen important concluding claims or syntheses. Keep the conclusion selective, but do not omit clear evidentiary support for major field-level statements.' : 'Do NOT use any citation format like [1], [2, 3] in the conclusion. Write the conclusion without references or citations.'}\n\nPlease generate only the conclusion section:`,
  }
}

export function parseTitleAndAbstract(markdownText: string, fallbackTitle: string, language: NFTCORELanguage): TitleAbstractResult {
  const source = String(markdownText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .trim()

  const titleMatch = source.match(/^#\s*(.+)$/m)
  const abstractHeading = language === 'zh' ? '摘要' : 'Abstract'
  const abstractHeadingRegex = new RegExp(`^##\\s*${abstractHeading}\\s*$`, 'im')
  const abstractMatch = abstractHeadingRegex.exec(source)
  const title = String(titleMatch?.[1] || fallbackTitle).trim().replace(/^[Tt]itle\s*:?\s*/, '').trim() || fallbackTitle

  let abstract = ''
  if (abstractMatch) {
    abstract = source.slice(abstractMatch.index + abstractMatch[0].length).trim()
  } else {
    abstract = source.replace(/^#\s*.+$/m, '').replace(/^##\s*.+$/m, '').trim()
  }

  return { title, abstract }
}

export function shouldDeferReferenceInsertion(paperType: NFTCOREPaperType): boolean {
  return paperType === 'review' || paperType === 'research'
}