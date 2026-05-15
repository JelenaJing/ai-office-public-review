/**
 * 论文分步执行引擎 — paperProjectRunner
 *
 * 每个 run* 函数对应一个独立的生成阶段，读写 PaperProjectStore 中的会话状态。
 * 进度通过 ProgressEmitter 回调推送（格式与 scope:'paper' 兼容，增加 projectId 字段）。
 */

import type { AppSettings } from './settingsStore'
import { completeText } from './llmClient'
import { searchReferencesWithNftcoreStrategy, formatReferenceList, type ReferenceItem } from './openAlexClient'
import {
  generateSectionThinking,
  generateSectionBodyWithCitations,
  buildReferenceContext,
  appendMarkdown,
  stripMarkdownHeading,
  normalizeGeneratedTitle,
  stripAbstractCitationMarks,
  streamPromptText,
  type PaperGenerationParams,
} from './paperGeneratorNFTCORE'
import { buildPaperPlanDynamic, type SectionPlan } from './paperStructurePlanner'
import {
  buildTitleAbstractPrompt,
  parseTitleAndAbstract,
  buildConclusionPrompt,
  shouldDeferReferenceInsertion,
  type CitationMode,
} from './nftcorePromptFactory'
import { organizeReferencesStream } from './referenceManager'
import { generateSectionFigures } from './advancedFigureGenerator'
import { reviewFullPaper } from './paperQualityControl'
import { parsePaperMarkdownToEmbeddedBlocks } from '../../../src/engines/documentEngine/embeddedPaperDocument'
import { buildGeneratedOoxmlSnapshot } from './generatedOoxmlSnapshot'
import {
  storeGetProject,
  storeUpdateProject,
  initSectionsFromPlan,
  type PaperProject,
} from './paperProjectStore'
import type { PaperGenerationResult } from './paperGeneratorNFTCORE'

export type ProgressEmitter = (event: Record<string, unknown>) => void

// ── Local helpers ──────────────────────────────────────────────────────────

function mergeUniqueRefs(...groups: ReferenceItem[][]): ReferenceItem[] {
  const seen = new Set<string>()
  const merged: ReferenceItem[] = []
  for (const group of groups) {
    for (const item of group) {
      const key = `${String(item.doi || '').trim().toLowerCase()}|${String(item.title || '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

async function buildEnglishQuery(settings: AppSettings, topic: string): Promise<string | null> {
  const hasCjk = /[\u4e00-\u9fff]/.test(String(topic || ''))
  if (!hasCjk) return null
  try {
    const response = await completeText(settings, {
      systemPrompt: 'You rewrite Chinese academic topics into concise English literature search queries. Output one line only.',
      userPrompt: `请将以下中文学术主题改写为适合 OpenAlex 检索的简洁英文 query，保留核心研究对象与任务，不超过 14 个英文单词，不要解释，不要加引号。\n主题：${topic}`,
      temperature: 0.2,
      maxTokens: 60,
    })
    return String(response || '').trim().replace(/[\r\n]+/g, ' ').replace(/^['"]+|['"]+$/g, '').trim() || null
  } catch {
    return null
  }
}

function requireProject(projectId: string): PaperProject {
  const project = storeGetProject(projectId)
  if (!project) throw new Error(`Paper project not found: ${projectId}`)
  return project
}

// ── Phase 1: Init (references + plan + title/abstract) ─────────────────────

export async function runInitProject(
  projectId: string,
  settings: AppSettings,
  emit: ProgressEmitter,
): Promise<void> {
  let project = requireProject(projectId)
  storeUpdateProject(projectId, (p) => ({ ...p, status: 'initializing' }))

  const params = project.params
  let step = 1

  const emitProgress = (message: string, extra?: Record<string, unknown>) => {
    emit({ scope: 'paper-section', type: 'progress', projectId, step: step++, message, ...extra })
  }

  // ── Step 1-2: Reference search ──────────────────────────────────────────
  emitProgress('校验输入并初始化生成会话')
  emitProgress('准备文献检索查询')

  let references: ReferenceItem[] = []
  try {
    references = await searchReferencesWithNftcoreStrategy(settings, {
      topic: params.topic,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      maxResults: settings.defaults.referenceCandidatePoolSize || 100,
    })
    const minimumPool = Math.min(12, Math.max(4, Math.floor((settings.defaults.referenceCandidatePoolSize || 100) / 4)))
    if (references.length < minimumPool) {
      const englishQuery = await buildEnglishQuery(settings, params.topic)
      if (englishQuery && englishQuery.toLowerCase() !== params.topic.toLowerCase()) {
        const expanded = await searchReferencesWithNftcoreStrategy(settings, {
          topic: englishQuery,
          yearFrom: params.yearFrom,
          yearTo: params.yearTo,
          maxResults: settings.defaults.referenceCandidatePoolSize || 100,
        })
        references = mergeUniqueRefs(references, expanded)
      }
    }
    emitProgress(`已检索到 ${references.length} 篇候选文献`, { eventType: 'references', references })
  } catch (error) {
    references = []
    emitProgress(`文献检索失败，已跳过: ${error instanceof Error ? error.message : String(error)}`)
  }

  storeUpdateProject(projectId, (p) => ({ ...p, references, organizedReferences: references }))

  // ── Step 3: Structure planning ──────────────────────────────────────────
  emitProgress('正在规划论文结构...')
  const paperPlan = await buildPaperPlanDynamic(settings, params, references)
  emitProgress(`结构规划完成，共 ${paperPlan.sections.length} 章节`, {
    outline: paperPlan.sections.map((s: SectionPlan) => s.title),
  })

  // ── Step 4: Title + Abstract ────────────────────────────────────────────
  emitProgress('正在生成标题和摘要...')
  const refContextLimit = Math.max(8, Math.min(40, references.length || 8))
  const referenceContext = buildReferenceContext(references, refContextLimit)

  const titleAbstractPrompt = buildTitleAbstractPrompt({
    topic: params.topic,
    language: params.language,
    paperType: params.paperType,
    extraContext: params.extraContext,
    sections: paperPlan.sections,
  })
  const promptWithRefs = referenceContext
    ? `${titleAbstractPrompt.userPrompt}\n\nReference pool:\n${referenceContext}`
    : titleAbstractPrompt.userPrompt

  const titleAbstractText = await completeText(settings, {
    systemPrompt: titleAbstractPrompt.systemPrompt,
    userPrompt: promptWithRefs,
    temperature: 0.5,
    maxTokens: 600,
  })

  const { title, abstract } = parseTitleAndAbstract(titleAbstractText, params.topic, params.language)
  const normalizedTitle = normalizeGeneratedTitle(title, params.topic)
  const abstractHeading = params.language === 'zh' ? '摘要' : 'Abstract'
  const abstractMarkdown = `## ${abstractHeading}\n\n${stripMarkdownHeading(abstract)}`
  const titleMarkdown = `# ${normalizedTitle}`
  const assembledMarkdown = appendMarkdown(titleMarkdown, abstractMarkdown)

  emitProgress(`标题和摘要已生成: ${normalizedTitle}`, {
    type: 'content',
    cumulativeMarkdown: assembledMarkdown,
    contentType: 'outline',
  })

  // ── Persist ────────────────────────────────────────────────────────────
  storeUpdateProject(projectId, (p) => ({
    ...p,
    references,
    organizedReferences: references,
    paperPlan,
    title: normalizedTitle,
    abstract,
    sections: initSectionsFromPlan(paperPlan),
    assembledMarkdown,
    status: 'outline_ready',
  }))

  project = requireProject(projectId)
  emit({
    scope: 'paper-section',
    type: 'init_done',
    projectId,
    title: normalizedTitle,
    sectionTitles: paperPlan.sections.map((s: SectionPlan) => s.title),
    cumulativeMarkdown: assembledMarkdown,
  })
}

// ── Phase 2: Generate one section ─────────────────────────────────────────

export async function runSection(
  projectId: string,
  sectionIndex: number,
  settings: AppSettings,
  emit: ProgressEmitter,
): Promise<void> {
  let project = requireProject(projectId)

  if (!project.paperPlan) throw new Error('Project has no paper plan. Run initProject first.')
  if (sectionIndex < 0 || sectionIndex >= project.sections.length) {
    throw new Error(`Invalid section index: ${sectionIndex}`)
  }

  const params = project.params
  const sectionPlan = project.sections[sectionIndex].plan
  const citationMode: CitationMode = params.citationMode
    || (shouldDeferReferenceInsertion(params.paperType) ? 'deferred' : 'inline')

  let step = 1
  const emitProgress = (message: string, extra?: Record<string, unknown>) => {
    emit({ scope: 'paper-section', type: 'progress', projectId, sectionIndex, step: step++, message, ...extra })
  }

  // Mark section as running
  storeUpdateProject(projectId, (p) => {
    const sections = [...p.sections]
    sections[sectionIndex] = { ...sections[sectionIndex], status: 'running' }
    return { ...p, status: 'partial', sections }
  })

  try {
    project = requireProject(projectId)
    const assembledMarkdown = project.assembledMarkdown
    const referenceContext = buildReferenceContext(
      project.references,
      Math.max(8, Math.min(40, project.references.length || 8)),
    )

    // ── Section thinking (optional) ────────────────────────────────────
    let thinking = ''
    if (!params.skipSectionThinking) {
      emitProgress(`正在生成章节「${sectionPlan.title}」的写作思路...`)
      thinking = await generateSectionThinking(settings, params, sectionPlan, assembledMarkdown)
      emitProgress(`章节「${sectionPlan.title}」思路已生成`, {
        content: `\n<thinking section="${sectionPlan.title}">\n${thinking}\n</thinking>\n`,
        contentType: 'thinking',
      })
    }

    // ── Section body ────────────────────────────────────────────────────
    const bodyStep = step++
    emitProgress(`正在生成章节「${sectionPlan.title}」正文...`)

    const sectionBaseMarkdown = project.assembledMarkdown
    let streamedBody = ''

    const sectionBody = await generateSectionBodyWithCitations(
      settings,
      params,
      sectionPlan,
      thinking,
      sectionBaseMarkdown,
      project.title,
      referenceContext,
      (_chunk, accumulated) => {
        const blockMarkdown = `## ${sectionPlan.title}\n\n${stripMarkdownHeading(accumulated)}`.trim()
        if (blockMarkdown !== streamedBody) {
          streamedBody = blockMarkdown
          emit({
            scope: 'paper-section',
            type: 'content',
            projectId,
            sectionIndex,
            step: bodyStep,
            message: '正文生成中',
            content: blockMarkdown,
            contentType: 'body',
            cumulativeMarkdown: appendMarkdown(sectionBaseMarkdown, blockMarkdown),
          })
        }
      },
    )

    const normalizedSection = `## ${sectionPlan.title}\n\n${stripMarkdownHeading(sectionBody)}`
    let newAssembledMarkdown = appendMarkdown(sectionBaseMarkdown, normalizedSection)

    // ── Figures (optional) ──────────────────────────────────────────────
    let figures: Array<{ path: string; caption: string; markdown: string; url: string }> = []
    if (params.withImages !== false && sectionPlan.plannedFigureCount && sectionPlan.plannedFigureCount > 0) {
      try {
        emitProgress(`正在为章节「${sectionPlan.title}」生成图片...`)
        const generatedFigures = await generateSectionFigures(
          settings,
          project.outputDir,
          {
            topic: params.topic,
            language: params.language,
            sectionTitle: sectionPlan.title,
            sectionText: sectionBody,
            sectionNum: sectionIndex + 1,
            plannedFigureCount: Math.min(sectionPlan.plannedFigureCount, 1),
          },
          (message) => emitProgress(message),
        )
        for (const fig of generatedFigures) {
          const figMarkdown = fig.markdown || `![${fig.caption}](${fig.localPath || fig.url})`
          newAssembledMarkdown = appendMarkdown(newAssembledMarkdown, figMarkdown)
          figures.push({ path: fig.localPath || fig.url, caption: fig.caption, markdown: figMarkdown, url: fig.url })
        }
        if (generatedFigures.length > 0) {
          emit({
            scope: 'paper-section',
            type: 'content',
            projectId,
            sectionIndex,
            step: bodyStep,
            message: `图片已生成`,
            contentType: 'body',
            cumulativeMarkdown: newAssembledMarkdown,
            eventType: 'image',
          })
        }
      } catch {
        // figure generation is best-effort
      }
    }

    // ── Persist ─────────────────────────────────────────────────────────
    storeUpdateProject(projectId, (p) => {
      const sections = [...p.sections]
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        status: 'done',
        thinking,
        content: sectionBody,
        figures,
      }
      return { ...p, sections, assembledMarkdown: newAssembledMarkdown }
    })

    emit({
      scope: 'paper-section',
      type: 'section_done',
      projectId,
      sectionIndex,
      sectionTitle: sectionPlan.title,
      cumulativeMarkdown: newAssembledMarkdown,
    })
  } catch (error) {
    storeUpdateProject(projectId, (p) => {
      const sections = [...p.sections]
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      return { ...p, sections }
    })
    emit({
      scope: 'paper-section',
      type: 'error',
      projectId,
      sectionIndex,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// ── Phase 3: Generate conclusion ───────────────────────────────────────────

export async function runConclusion(
  projectId: string,
  settings: AppSettings,
  emit: ProgressEmitter,
): Promise<void> {
  let project = requireProject(projectId)
  const params = project.params
  const citationMode: CitationMode = params.citationMode
    || (shouldDeferReferenceInsertion(params.paperType) ? 'deferred' : 'inline')
  const conclusionTitle = params.language === 'zh' ? '结论' : 'Conclusion'

  let step = 1
  const emitProgress = (message: string, extra?: Record<string, unknown>) => {
    emit({ scope: 'paper-section', type: 'progress', projectId, step: step++, message, ...extra })
  }

  storeUpdateProject(projectId, (p) => ({
    ...p,
    conclusion: { ...p.conclusion, status: 'running' },
  }))

  try {
    const referenceContext = buildReferenceContext(
      project.references,
      Math.max(8, Math.min(40, project.references.length || 8)),
    )
    const conclusionBaseMarkdown = project.assembledMarkdown

    // ── Conclusion thinking ─────────────────────────────────────────────
    let conclusionThinking = ''
    if (!params.skipSectionThinking) {
      emitProgress('正在生成结论写作思路...')
      const thinkingPrompt = buildConclusionPrompt({
        topic: params.topic,
        language: params.language,
        paperType: params.paperType,
        extraContext: params.extraContext,
        previousMarkdown: conclusionBaseMarkdown,
        title: project.title,
        citationMode,
        referenceContext,
      })
      conclusionThinking = await completeText(settings, {
        systemPrompt: thinkingPrompt.systemPrompt,
        userPrompt: `Generate a structured thinking plan for the conclusion section. Focus on: 1) key findings to summarize, 2) research contributions, 3) limitations, 4) future directions.\n\nContext: ${thinkingPrompt.userPrompt}`,
        temperature: 0.4,
        maxTokens: 600,
      })
      emitProgress('结论写作思路已生成', {
        content: `\n<thinking section="${conclusionTitle}">\n${conclusionThinking}\n</thinking>\n`,
        contentType: 'thinking',
      })
    }

    // ── Conclusion body ─────────────────────────────────────────────────
    const conclusionStep = step++
    emitProgress(`正在生成结论章节...`)

    const conclusionPrompt = buildConclusionPrompt({
      topic: params.topic,
      language: params.language,
      paperType: params.paperType,
      extraContext: params.extraContext,
      previousMarkdown: conclusionBaseMarkdown,
      title: project.title,
      citationMode,
      referenceContext,
    })
    const conclusionUserPrompt = conclusionThinking.trim()
      ? `${conclusionPrompt.userPrompt}\n\nPlanning notes for this conclusion:\n${conclusionThinking.trim()}`
      : conclusionPrompt.userPrompt

    let streamedConclusionBody = ''
    const conclusionBody = await streamPromptText(
      settings,
      {
        systemPrompt: conclusionPrompt.systemPrompt,
        userPrompt: conclusionUserPrompt,
        temperature: 0.5,
        maxTokens: 1200,
      },
      (_chunk, accumulated) => {
        const blockMarkdown = `## ${conclusionTitle}\n\n${stripMarkdownHeading(accumulated)}`.trim()
        if (blockMarkdown !== streamedConclusionBody) {
          streamedConclusionBody = blockMarkdown
          emit({
            scope: 'paper-section',
            type: 'content',
            projectId,
            step: conclusionStep,
            message: '结论正文生成中',
            content: blockMarkdown,
            contentType: 'body',
            cumulativeMarkdown: appendMarkdown(conclusionBaseMarkdown, blockMarkdown),
          })
        }
      },
    )

    const normalizedConclusion = `## ${conclusionTitle}\n\n${stripMarkdownHeading(conclusionBody)}`
    const newAssembledMarkdown = appendMarkdown(conclusionBaseMarkdown, normalizedConclusion)

    storeUpdateProject(projectId, (p) => ({
      ...p,
      conclusion: { status: 'done', thinking: conclusionThinking, content: conclusionBody },
      assembledMarkdown: newAssembledMarkdown,
    }))

    emit({
      scope: 'paper-section',
      type: 'conclusion_done',
      projectId,
      cumulativeMarkdown: newAssembledMarkdown,
    })
  } catch (error) {
    storeUpdateProject(projectId, (p) => ({
      ...p,
      conclusion: { ...p.conclusion, status: 'error', error: error instanceof Error ? error.message : String(error) },
    }))
    emit({
      scope: 'paper-section',
      type: 'error',
      projectId,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// ── Phase 4: Finalize (ref organization + review + package) ───────────────

export async function runFinalizeProject(
  projectId: string,
  settings: AppSettings,
  emit: ProgressEmitter,
): Promise<PaperGenerationResult> {
  let project = requireProject(projectId)
  const params = project.params

  let step = 1
  const emitProgress = (message: string, extra?: Record<string, unknown>) => {
    emit({ scope: 'paper-section', type: 'progress', projectId, step: step++, message, ...extra })
  }

  storeUpdateProject(projectId, (p) => ({ ...p, status: 'finalizing' }))

  // ── Step 1: Reference organization ────────────────────────────────────
  emitProgress('正在整理引用...', { eventType: 'references', referenceAction: 'status' })

  let assembledMarkdown = project.assembledMarkdown
  let organizedReferences = project.organizedReferences.length > 0 ? project.organizedReferences : project.references

  try {
    const allRefs = mergeUniqueRefs(project.references, organizedReferences)
    const refOrgResult = await organizeReferencesStream(
      settings,
      {
        topic: params.topic,
        paperMarkdown: assembledMarkdown,
        references: allRefs,
        enableVerification: params.finalReferenceVerification !== false,
        analysisWindowSize: settings.defaults.referenceAnalysisWindow || 8,
        targetReferenceCount: settings.defaults.referenceCount || 50,
        referenceSoftFloorPercent: settings.defaults.referenceSoftFloorPercent ?? 80,
        referenceTargetMode: params.referenceTargetMode === 'hard' ? 'hard' : 'soft',
        supplementalMode: params.finalReferencePassMode || 'weak',
      },
      (update) => {
        if (update.type === 'reference_inserted') {
          emit({
            scope: 'paper-section',
            type: 'progress',
            projectId,
            step,
            message: `引用处理中...`,
            eventType: 'references',
            referenceAction: 'reference_inserted',
          })
        }
      },
    )

    assembledMarkdown = refOrgResult.updatedMarkdown || assembledMarkdown
    organizedReferences = Array.isArray(refOrgResult.referenceList) && refOrgResult.referenceList.length > 0
      ? refOrgResult.referenceList
      : organizedReferences
    assembledMarkdown = stripAbstractCitationMarks(assembledMarkdown)

    emitProgress('引用整理完成', {
      eventType: 'references',
      referenceAction: 'complete',
      references: organizedReferences,
      cumulativeMarkdown: assembledMarkdown,
    })
  } catch (error) {
    emitProgress(`引用整理失败（已跳过）: ${error instanceof Error ? error.message : String(error)}`)
  }

  storeUpdateProject(projectId, (p) => ({ ...p, assembledMarkdown, organizedReferences }))

  // ── Step 2: Full review (optional) ────────────────────────────────────
  let reviewResult: Awaited<ReturnType<typeof reviewFullPaper>> | undefined
  if (params.enableFullReview !== false) {
    emitProgress('正在进行全文审查...')
    try {
      reviewResult = await reviewFullPaper(settings, assembledMarkdown, params.topic, params.paperType, params.language)
      emitProgress(`全文审查完成，评分：${reviewResult.overallScore}/5`, {
        eventType: 'review',
        content: `**评分**: ${reviewResult.overallScore}/5\n**反馈**: ${reviewResult.feedback}`,
        contentType: 'review_result',
      })
    } catch (error) {
      emitProgress(`全文审查失败（已跳过）: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ── Step 3: Append references section ────────────────────────────────
  const referencesTitle = params.language === 'zh' ? '参考文献' : 'References'
  const finalReferencePool = organizedReferences.length > 0 ? organizedReferences : project.references
  const referencesMarkdown = formatReferenceList(finalReferencePool)
  assembledMarkdown = stripAbstractCitationMarks(assembledMarkdown)
  assembledMarkdown = appendMarkdown(assembledMarkdown, `## ${referencesTitle}\n\n${referencesMarkdown}`)

  emitProgress('参考文献已整理完成', {
    content: `## ${referencesTitle}\n\n${referencesMarkdown}`,
    contentType: 'body',
    eventType: 'references',
    referenceAction: 'complete',
    references: organizedReferences,
    cumulativeMarkdown: assembledMarkdown,
  })

  // ── Step 4: Finalize ──────────────────────────────────────────────────
  emitProgress('正在封装最终论文产物', {
    content: assembledMarkdown,
    contentType: 'final',
    cumulativeMarkdown: assembledMarkdown,
  })

  storeUpdateProject(projectId, (p) => ({ ...p, assembledMarkdown, organizedReferences: finalReferencePool, status: 'complete' }))

  const finalStructuredBlocks = parsePaperMarkdownToEmbeddedBlocks(assembledMarkdown, { references: organizedReferences })
  const ooxmlSnapshot = await buildGeneratedOoxmlSnapshot(finalStructuredBlocks as never)

  project = requireProject(projectId)
  const allFigures = project.sections.flatMap((s, idx) =>
    s.figures.map((fig) => ({
      section: String(idx + 1),
      sectionTitle: s.plan.title,
      path: fig.path,
      caption: fig.caption,
      markdown: fig.markdown,
      url: fig.url,
    })),
  )

  const result: PaperGenerationResult = {
    title: project.title,
    markdown: assembledMarkdown,
    structuredBlocks: finalStructuredBlocks,
    ooxmlSnapshot: ooxmlSnapshot as unknown as Record<string, unknown>,
    references: finalReferencePool,
    images: allFigures,
    steps: [],
    paperPlan: project.paperPlan ?? undefined,
    reviewResult,
  }

  emit({
    scope: 'paper-section',
    type: 'finalize_done',
    projectId,
    result,
    cumulativeMarkdown: assembledMarkdown,
  })

  return result
}
