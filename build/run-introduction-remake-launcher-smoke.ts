import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { IntroductionRemakeService } from '../../introduction-remake-app/electron/main/services/introductionRemake/introductionRemakeService'
import { citationIndicesInText, validateSequentialCitations } from '../../introduction-remake-app/electron/main/services/introductionRemake/citationRemap'
import { exportIntroductionRemakeBundle } from '../../introduction-remake-app/electron/main/services/introductionRemake/taskArtifacts'
import { hydrateQwenEnv } from './qwenDefaults'

const sampleIntroduction = `Perovskite solar cells have emerged as a promising photovoltaic technology because they combine high power conversion efficiency with low-temperature solution processing. Rapid improvements in device efficiency have been driven by advances in composition engineering, interface passivation, and charge-transport design. Despite this progress, long-term operational stability under light, heat, oxygen, and moisture remains a central bottleneck for large-scale deployment. Previous studies have suggested that ion migration, interfacial non-radiative recombination, and phase segregation jointly contribute to performance loss, yet the relative importance of these mechanisms depends strongly on device architecture and processing route. A current research need is therefore a more integrated introduction that positions recent stability strategies across materials design, interface control, and encapsulation while maintaining clear evidential support from high-quality literature.`

async function hydrateIntroductionRemakeEnv(projectRoot: string): Promise<void> {
  const keys = hydrateQwenEnv(projectRoot)
  if (keys.qwenApiKey) {
    console.log('[smoke] loaded Qwen env from local env or builtin config')
  }
}

async function assertLauncherIntegration(projectRoot: string): Promise<void> {
  const rendererSource = await fs.readFile(path.join(projectRoot, 'src', 'App.tsx'), 'utf-8')
  const mainSource = await fs.readFile(path.join(projectRoot, 'electron', 'main', 'index.ts'), 'utf-8')
  const bundledRenderer = path.join(projectRoot, '..', 'introduction-remake-app', 'dist', 'index.html')

  assert.match(rendererSource, /launchCompanionApp\('introduction-remake'\)/, '启动器未接入 remake 入口')
  assert.match(mainSource, /suite:returnToLauncher/, '主进程未实现返回启动器 IPC')
  assert.match(mainSource, /introRemake:exportBundle/, '主进程未实现 remake 导出 IPC')
  await fs.access(bundledRenderer)
  console.log('[smoke] launcher integration ok')
}

async function runServiceFlow(projectRoot: string): Promise<void> {
  const service = new IntroductionRemakeService()
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-intro-launcher-smoke-'))
  const userDataDir = path.join(tempRoot, 'userdata')
  await fs.mkdir(userDataDir, { recursive: true })

  const topicMeta = service.inferTopicMeta(sampleIntroduction)
  const poolResponse = await service.buildAllowlistedPool({
    topic: topicMeta.openalexSearch || 'perovskite solar cell stability',
    minPublicationYear: Math.max(2017, Math.min(topicMeta.paperPublicationYear || 2020, 2023)),
    maxPapersForLlm: 8,
    secondPassTopic: 'perovskite solar cell interface passivation stability',
  })

  assert.ok(poolResponse.pool.length > 0, '文献池为空，无法执行 launcher smoke')

  let deltaEvents = 0
  const result = await new Promise<Awaited<ReturnType<IntroductionRemakeService['generateDraft']>>>((resolve, reject) => {
    const handle = service.generateDraftStream({
      originalIntroduction: sampleIntroduction,
      pool: poolResponse.pool,
      context: 'Keep the narrative concise, evidence-based, and explicitly centered on stability mechanisms and mitigation strategies.',
      onDelta: () => {
        deltaEvents += 1
      },
      onComplete: resolve,
      onError: (message) => {
        handle.cancel()
        reject(new Error(message))
      },
    })
  })

  assert.ok(deltaEvents > 0, '流式重写没有产生 delta 事件')
  assert.ok(result.references.length > 0, '重写结果没有参考文献')
  assert.ok(citationIndicesInText(result.sequentialIntroduction).length > 0, '顺序化正文没有检测到文内引用')
  assert.equal(validateSequentialCitations(result.sequentialIntroduction, result.references.length).ok, true, '顺序化引用校验失败')

  const auditText = [
    `topic=${topicMeta.openalexSearch}`,
    `pool=${poolResponse.pool.length}`,
    `references=${result.references.length}`,
    `provider=${result.provider}`,
    `model=${result.model}`,
  ].join('\n')

  const exportResult = await exportIntroductionRemakeBundle(userDataDir, {
    baseDirectory: tempRoot,
    topic: topicMeta.openalexSearch || 'perovskite solar cell stability',
    topicMeta,
    sourceIntroduction: sampleIntroduction,
    rewrittenDraft: result.remadeIntroduction,
    auditText,
    pool: poolResponse.pool,
    poolMeta: poolResponse.meta,
    result,
  })

  for (const filePath of exportResult.files) {
    await fs.access(filePath)
  }
  assert.equal(exportResult.task.status, 'exported', '导出后最近任务状态不是 exported')
  assert.ok(exportResult.tasks.length > 0, '最近任务列表为空')

  console.log('[smoke] stream delta events =', deltaEvents)
  console.log('[smoke] references =', result.references.length)
  console.log('[smoke] export dir =', exportResult.outputDir)
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(new URL('..', import.meta.url).pathname)
  await hydrateIntroductionRemakeEnv(projectRoot)
  await assertLauncherIntegration(projectRoot)
  await runServiceFlow(projectRoot)
  console.log('[smoke] launcher-remake flow ok')
}

main().catch((error) => {
  console.error('[smoke] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})