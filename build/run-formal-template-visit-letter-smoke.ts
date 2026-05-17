import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

const VISIT_LETTER_SAMPLE_PATH = path.resolve('docs/贺信_模板.docx')
const KEEP_ARTIFACTS = process.env.AI_WRITER_KEEP_FORMAL_TEMPLATE_SMOKE === '1'
const CONGRATULATION_FACTS = {
  recipient: '杭州市政府',
  date: '2026年4月',
  theme: '浙江人工智能产业发展',
  tone: '正式庄重',
  sender: '香港中文大学（深圳）招生办',
  optionalContext: '贵方持续推进人工智能科技创新、产业协同与场景开放，为区域高质量发展注入了新动能',
}
const GENERATION_INSTRUCTION = [
  '请基于当前贺信模板生成最终文稿。',
  `recipient = ${CONGRATULATION_FACTS.recipient}`,
  `date = ${CONGRATULATION_FACTS.date}`,
  `theme = ${CONGRATULATION_FACTS.theme}`,
  `tone = ${CONGRATULATION_FACTS.tone}`,
  `sender = ${CONGRATULATION_FACTS.sender}`,
  `optional_context = ${CONGRATULATION_FACTS.optionalContext}`,
].join('\n')

type DocumentEngineServiceCtor = new () => {
  readOoxmlPackage: (filePath: string) => Promise<any>
  writeOoxmlPackage: (filePath: string, payload: any) => Promise<any>
}

type FormalTemplateTaskServiceCtor = new (deps: {
  readOoxmlPackage: (filePath: string) => Promise<any>
  writeOoxmlPackage: (filePath: string, payload: any) => Promise<any>
  getDocumentSourcePath: (documentId: string) => Promise<string | null>
  getDocumentMeta: (documentId: string) => Promise<any>
  retrieveChunks: (query: any) => Promise<any>
  getSettings: () => Promise<any>
}) => {
  analyze: (request: any) => Promise<any>
  preview: (request: any) => Promise<any>
  commit: (request: any) => Promise<any>
}

async function loadServiceCtors(): Promise<{
  DocumentEngineService: DocumentEngineServiceCtor
  FormalTemplateTaskService: FormalTemplateTaskServiceCtor
}> {
  const documentEngineModule: any = await import('../electron/main/services/documentEngineService')
  const formalTemplateModule: any = await import('../electron/main/services/formalTemplate/formalTemplateTaskService')

  const DocumentEngineService = documentEngineModule.DocumentEngineService || documentEngineModule.default?.DocumentEngineService
  const FormalTemplateTaskService = formalTemplateModule.FormalTemplateTaskService || formalTemplateModule.default?.FormalTemplateTaskService

  if (!DocumentEngineService) {
    throw new Error('无法加载 DocumentEngineService 构造函数')
  }
  if (!FormalTemplateTaskService) {
    throw new Error('无法加载 FormalTemplateTaskService 构造函数')
  }

  return { DocumentEngineService, FormalTemplateTaskService }
}

function isHeaderFooterEntry(entryName: string): boolean {
  return /^word\/(header|footer)\d+\.xml$/i.test(entryName)
    || /^word\/_rels\/(header|footer)\d+\.xml\.rels$/i.test(entryName)
}

function resolveSourcePartFromRels(entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/')
  return normalized
    .replace('/_rels/', '/')
    .replace(/\.rels$/i, '')
}

function resolveRelationshipTargets(entryName: string, xml: string): string[] {
  const sourcePart = resolveSourcePartFromRels(entryName)
  const baseDir = path.posix.dirname(sourcePart)
  return Array.from(String(xml || '').matchAll(/Target="([^"]+)"/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
    .map((target) => path.posix.normalize(path.posix.join(baseDir, target)).replace(/^\/+/, ''))
}

async function loadZip(filePath: string): Promise<JSZip> {
  return JSZip.loadAsync(await fs.readFile(filePath))
}

async function collectHeaderFooterShellSnapshot(filePath: string): Promise<Map<string, Buffer>> {
  const zip = await loadZip(filePath)
  const entryNames = Object.keys(zip.files)
  const shellEntries = new Set(entryNames.filter(isHeaderFooterEntry))

  for (const entryName of Array.from(shellEntries)) {
    if (!/\.rels$/i.test(entryName)) continue
    const xml = await zip.file(entryName)?.async('text') || ''
    for (const targetEntry of resolveRelationshipTargets(entryName, xml)) {
      if (zip.file(targetEntry)) shellEntries.add(targetEntry)
    }
  }

  const snapshot = new Map<string, Buffer>()
  for (const entryName of Array.from(shellEntries).sort()) {
    const buffer = await zip.file(entryName)?.async('nodebuffer')
    if (buffer) snapshot.set(entryName, buffer)
  }
  return snapshot
}

function assertShellSnapshotEqual(actual: Map<string, Buffer>, expected: Map<string, Buffer>, label: string): void {
  assert.deepEqual(Array.from(actual.keys()), Array.from(expected.keys()), `${label}: 页眉/页脚相关条目集合发生变化`)
  for (const [entryName, expectedBuffer] of expected.entries()) {
    const actualBuffer = actual.get(entryName)
    assert.ok(actualBuffer, `${label}: 缺少条目 ${entryName}`)
    assert.equal(Buffer.compare(actualBuffer, expectedBuffer), 0, `${label}: 条目字节发生变化 ${entryName}`)
  }
}

function collectChangedIndices(beforeSnapshot: any, afterSnapshot: any): number[] {
  const maxLength = Math.max(beforeSnapshot.blocks.length, afterSnapshot.blocks.length)
  const changed: number[] = []
  for (let index = 0; index < maxLength; index += 1) {
    const before = beforeSnapshot.blocks[index]
    const after = afterSnapshot.blocks[index]
    if (!before || !after || before.kind !== after.kind || before.text !== after.text || before.sourceId !== after.sourceId) {
      changed.push(index)
    }
  }

  return changed
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim()
}

function extractParagraphProperties(paragraphXml: string): string {
  return paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/i)?.[0] || ''
}

function extractFirstRunProperties(paragraphXml: string): string {
  const firstTextRunXml = paragraphXml.match(/<w:r\b[\s\S]*?<w:t(?:\s+[^>]*)?>[\s\S]*?<\/w:t>[\s\S]*?<\/w:r>/i)?.[0] || ''
  const paragraphProperties = extractParagraphProperties(paragraphXml)
  const paragraphMarkRunProperties = paragraphProperties.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0] || ''
  return firstTextRunXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0]
    || paragraphMarkRunProperties
    || paragraphXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0]
    || ''
}

function normalizeXmlFragment(value: string): string {
  return String(value || '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
}

function assertBodyParagraphFormattingInherited(beforeBlocks: any[], afterBlocks: any[]): void {
  assert.ok(beforeBlocks.length > 0, '正文模板段落不能为空')
  assert.ok(afterBlocks.length > 0, '写回后的正文段落不能为空')

  afterBlocks.forEach((afterBlock, index) => {
    const templateBlock = beforeBlocks[Math.min(index, beforeBlocks.length - 1)]
    assert.ok(templateBlock?.sourceXml, `正文模板段 ${index + 1} 缺少 sourceXml`)
    assert.ok(afterBlock?.sourceXml, `写回后的正文段 ${index + 1} 缺少 sourceXml`)
    assert.equal(
      normalizeXmlFragment(extractParagraphProperties(afterBlock.sourceXml)),
      normalizeXmlFragment(extractParagraphProperties(templateBlock.sourceXml)),
      `正文段 ${index + 1} 的 w:pPr 发生变化`,
    )
    assert.equal(
      normalizeXmlFragment(extractFirstRunProperties(afterBlock.sourceXml)),
      normalizeXmlFragment(extractFirstRunProperties(templateBlock.sourceXml)),
      `正文段 ${index + 1} 的首文本 w:rPr 发生变化`,
    )
  })
}

function findBlockIndexByText(blocks: any[], text: string): number {
  const normalizedTarget = normalizeText(text)
  return blocks.findIndex((block) => normalizeText(block?.text || '') === normalizedTarget)
}

function collectBodyBlocksBetweenAnchors(blocks: any[], salutationText: string, signatureText: string): any[] {
  const salutationIndex = findBlockIndexByText(blocks, salutationText)
  const signatureIndex = findBlockIndexByText(blocks, signatureText)
  assert.ok(salutationIndex >= 0, '写回后未找到称谓锚点')
  assert.ok(signatureIndex > salutationIndex, '写回后未找到有效落款锚点')
  return blocks.slice(salutationIndex + 1, signatureIndex)
}

function buildFieldValues(profile: any): any[] {
  const overrides: Record<string, string> = {
    recipient: CONGRATULATION_FACTS.recipient,
    'letter-date': CONGRATULATION_FACTS.date,
    theme: CONGRATULATION_FACTS.theme,
    tone: CONGRATULATION_FACTS.tone,
    sender: CONGRATULATION_FACTS.sender,
    'optional-context': CONGRATULATION_FACTS.optionalContext,
  }

  return profile.fields.map((field: any) => {
    const matchedKey = Object.keys(overrides).find((key) => String(field.fieldId).endsWith(`-${key}`))
    return {
      fieldId: field.fieldId,
      value: matchedKey ? overrides[matchedKey] : field.defaultText,
      userOverride: Boolean(matchedKey),
      confirmed: true,
    }
  })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (!(await pathExists(VISIT_LETTER_SAMPLE_PATH))) {
    throw new Error(`未找到 letter_template 样例: ${VISIT_LETTER_SAMPLE_PATH}`)
  }

  const { DocumentEngineService, FormalTemplateTaskService } = await loadServiceCtors()
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-formal-template-visit-letter-'))
  const workspacePath = path.join(tempRoot, 'workspace')
  await fs.mkdir(workspacePath, { recursive: true })

  const documentEngineService = new DocumentEngineService()
  const formalTemplateTaskService = new FormalTemplateTaskService({
    readOoxmlPackage: (filePath: string) => documentEngineService.readOoxmlPackage(filePath),
    writeOoxmlPackage: (filePath: string, payload: any) => documentEngineService.writeOoxmlPackage(filePath, payload),
    getDocumentSourcePath: async (documentId: string) => documentId === 'visit-letter-sample' ? VISIT_LETTER_SAMPLE_PATH : null,
    getDocumentMeta: async () => ({
      title: '贺信_模板',
      sourceType: 'docx',
      documentCategory: 'letter',
    }),
    retrieveChunks: async () => ({ hits: [], citations: [] }),
    getSettings: async () => ({}),
  })

  try {
    const analyzeResponse = await formalTemplateTaskService.analyze({
      knowledgeDocumentId: 'visit-letter-sample',
      workspacePath,
    })
    assert.equal(analyzeResponse.success, true, `analyze 失败: ${analyzeResponse.errorCode || ''} ${analyzeResponse.errorMessage || ''}`)
    const profile = analyzeResponse.profile
    assert.ok(profile, 'analyze 成功后必须返回 profile')
    assert.equal(profile.routingPlan?.defaultExecution.mode, 'schema-first', 'visit-letter 默认执行模式必须是 schema-first')
    assert.equal(profile.routingPlan?.defaultExecution.strategy, 'base-replace', 'visit-letter 默认 schema-first 策略必须是 base-replace')
    assert.equal(profile.routingPlan?.templateKind, 'congratulation-letter', '当前样例应识别为 congratulation-letter')

    const beforeSnapshot = await documentEngineService.readOoxmlPackage(profile.workCopyPath)
    const beforeShellSnapshot = await collectHeaderFooterShellSnapshot(profile.workCopyPath)
    const fieldValues = buildFieldValues(profile)
    const titleRegion = profile.regions.find((region: any) => String(region.label).includes('标题'))
    const salutationRegion = profile.regions.find((region: any) => String(region.label).includes('称谓'))
    const middleBodyRegion = profile.regions.find((region: any) => region.regionId === 'visit-letter-region-middle-body')
    const signatureRegion = profile.regions.find((region: any) => String(region.label).includes('落款'))
    assert.ok(titleRegion, '样例必须存在标题锁定区')
    assert.ok(salutationRegion, '样例必须存在称谓锁定区')
    assert.ok(middleBodyRegion, '样例必须存在唯一正文区')
    assert.ok(signatureRegion, '样例必须存在落款锁定区')

    const previewResponse = await formalTemplateTaskService.preview({
      profileId: profile.profileId,
      workCopyPath: profile.workCopyPath,
      instruction: GENERATION_INSTRUCTION,
      referenceDocumentIds: [],
      sampleDocumentIds: [],
      fieldValues,
      retrievalMode: 'selected-only',
    })
    assert.equal(previewResponse.success, true, `preview 失败: ${previewResponse.errorCode || ''} ${previewResponse.errorMessage || ''}`)
    assert.ok(previewResponse.regionCandidate, 'preview 必须返回唯一中间正文候选')
    assert.deepEqual(previewResponse.plan.pendingFieldIds, [], '当前贺信事实应在正文生成前全部解析完成')

    const candidateText = String(previewResponse.regionCandidate.candidateText || '')
    const candidateParagraphs = (previewResponse.regionCandidate.candidateParagraphs || candidateText.split(/\n+/))
      .map((line: string) => line.trim())
      .filter(Boolean)
    assert.equal(candidateParagraphs.length, 4, '贺信模板 preview candidate 必须保持 4 段正文')
    assert.equal(normalizeText(candidateParagraphs[0] || '').includes(normalizeText(CONGRATULATION_FACTS.theme)), true, '正文首段必须绑定用户主题')
    assert.equal(candidateText.includes('福建省福州第一中学'), false, 'preview candidate 不能泄漏原模板收件人')
    assert.equal(candidateText.includes('福州一中'), false, 'preview candidate 不能泄漏原模板简称')
    assert.equal(candidateText.includes('建校200周年'), false, 'preview candidate 不能沿用原模板祝贺语义')

    const commitResponse = await formalTemplateTaskService.commit({
      profileId: profile.profileId,
      workCopyPath: profile.workCopyPath,
      instruction: GENERATION_INSTRUCTION,
      fieldValues,
      regionPatches: [{
        regionId: previewResponse.regionCandidate.regionId,
        finalText: candidateText,
        finalParagraphs: candidateParagraphs,
      }],
    })

    assert.equal(commitResponse.success, true, `commit 失败: ${commitResponse.errorCode || ''} ${commitResponse.errorMessage || ''}`)
    assert.ok(commitResponse.result, 'commit 成功后必须返回 result')
    assert.equal(commitResponse.result.allCommitted, true, 'allCommitted 必须为 true')
    assert.equal(commitResponse.result.shellValidation.passed, true, 'shellValidation 必须通过')
    assert.equal(commitResponse.trace.steps.some((step: any) => String(step.label || '').includes('schema-first DOCX boundary compile')), true, 'visit-letter 默认主链必须走 schema-first compiler')
    assert.equal(commitResponse.trace.steps.some((step: any) => String(step.label || '').includes('legacy fallback')), false, 'visit-letter 默认主链不应触发 legacy fallback')
    assert.equal(commitResponse.result.executionMode?.mode, 'schema-first', 'visit-letter commit 结果必须标记为 schema-first')
    assert.equal(commitResponse.result.executionMode?.templateKind, 'congratulation-letter', 'visit-letter commit 结果必须标记模板类型')
    assert.ok(commitResponse.result.documentArtifact?.document, 'visit-letter schema-first commit 必须返回 documentArtifact.document')

    const afterSnapshot = await documentEngineService.readOoxmlPackage(profile.workCopyPath)
    const afterShellSnapshot = await collectHeaderFooterShellSnapshot(profile.workCopyPath)
    const changedIndices = collectChangedIndices(beforeSnapshot, afterSnapshot)
    assert.ok(changedIndices.length > 0, '正文写回后至少应有一个 block 发生变化')
    assertShellSnapshotEqual(afterShellSnapshot, beforeShellSnapshot, 'formal template visit letter smoke')

    const beforeTitle = beforeSnapshot.blocks
      .slice(titleRegion.blockRange.start, titleRegion.blockRange.end)
      .map((block: any) => block.text)
    const afterTitle = afterSnapshot.blocks
      .slice(titleRegion.blockRange.start, titleRegion.blockRange.end)
      .map((block: any) => block.text)
    assert.deepEqual(afterTitle, beforeTitle, '标题区文本必须保持不变')

    const afterSalutation = afterSnapshot.blocks
      .slice(salutationRegion.blockRange.start, salutationRegion.blockRange.end)
      .map((block: any) => block.text)
    assert.equal(normalizeText(afterSalutation[0] || ''), normalizeText(`${CONGRATULATION_FACTS.recipient}：`), '称谓区必须与用户收件人保持一致')

    const afterSignature = afterSnapshot.blocks
      .slice(signatureRegion.blockRange.start, signatureRegion.blockRange.end)
      .map((block: any) => block.text)
    assert.equal(normalizeText(afterSignature[0] || ''), normalizeText(CONGRATULATION_FACTS.sender), '落款区必须写成用户指定发信单位')
    assert.equal(normalizeText(afterSignature[afterSignature.length - 1] || ''), normalizeText(CONGRATULATION_FACTS.date), '日期区必须写成用户指定日期')

    const beforeBodyBlocks = beforeSnapshot.blocks.slice(middleBodyRegion.blockRange.start, middleBodyRegion.blockRange.end)
    const afterBodyBlocks = collectBodyBlocksBetweenAnchors(afterSnapshot.blocks, afterSalutation[0], afterSignature[0])
    const afterBodyParagraphs = afterBodyBlocks.map((block: any) => String(block.text || '').trim()).filter(Boolean)

    assert.equal(afterBodyParagraphs.length, candidateParagraphs.length, '写回后的正文段落数必须与 preview 段落数一致')
    assert.deepEqual(afterBodyParagraphs, candidateParagraphs, 'preview 与 DOCX 导出的正文段落列表必须一致')
    assert.equal(/^([^，。；：、,.!?])/u.test(afterBodyParagraphs[0] || ''), true, '正文首段不能从半句或标点开始')
    assert.equal(normalizeText(afterBodyParagraphs[0] || '').includes(normalizeText(CONGRATULATION_FACTS.theme)), true, '写回后的首段必须绑定用户主题')
    assertBodyParagraphFormattingInherited(beforeBodyBlocks, afterBodyBlocks)

    assert.equal(normalizeText(afterTitle[0] || ''), '贺信', '标题应保持为贺信')
    assert.equal(afterSnapshot.plainText.includes(CONGRATULATION_FACTS.recipient), true, '最终文稿必须包含用户收件人')
    assert.equal(afterSnapshot.plainText.includes(CONGRATULATION_FACTS.theme), true, '最终文稿必须包含用户主题')
    assert.equal(afterSnapshot.plainText.includes('福建省福州第一中学'), false, '最终文稿不能泄漏原模板收件人')
    assert.equal(afterSnapshot.plainText.includes('福州一中'), false, '最终文稿不能泄漏原模板简称')
    assert.equal(afterSnapshot.plainText.includes('建校200周年'), false, '最终文稿不能泄漏原模板祝贺语义')

    console.log('formal template visit letter smoke passed')
    console.log(JSON.stringify({
      samplePath: VISIT_LETTER_SAMPLE_PATH,
      workCopyPath: profile.workCopyPath,
      keptArtifacts: KEEP_ARTIFACTS,
      profileId: profile.profileId,
      executionMode: commitResponse.result.executionMode,
      shellValidation: commitResponse.result.shellValidation,
      changedIndices,
      shellEntries: Array.from(beforeShellSnapshot.keys()),
    }, null, 2))
  } finally {
    if (!KEEP_ARTIFACTS) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})