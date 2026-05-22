/**
 * Workspace activity progress report smoke test
 *
 * 运行: npm exec --yes --package tsx tsx scripts/run-workspace-activity-report-smoke.ts
 */

import {
  buildDailyActivityReportFromProgressJson,
  buildProgressEvidence,
  createNoEffectiveActivityReport,
  takeSnapshot,
} from '../electron/main/services/workspaceActivityService'
import type { DailyReportInput, WorkActivityEvent } from '../src/types/workActivityTypes'
import type { FileContentSummary } from '../src/types/workspaceActivity'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.error(`  ✗ ${label}`)
  }
}

function makeEvent(overrides: Partial<WorkActivityEvent> & Pick<WorkActivityEvent, 'eventType'>): WorkActivityEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(16).slice(2)}`,
    ts: overrides.ts ?? '2026-05-19T09:00:00.000+08:00',
    dateKey: overrides.dateKey ?? '2026-05-19',
    sessionId: overrides.sessionId ?? 'session-smoke',
    module: overrides.module ?? 'smoke',
    eventType: overrides.eventType,
    action: overrides.action,
    targetType: overrides.targetType,
    targetId: overrides.targetId,
    targetTitle: overrides.targetTitle,
    durationMs: overrides.durationMs,
    status: overrides.status ?? 'success',
    payload: overrides.payload,
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
  }
}

function makeInput(events: WorkActivityEvent[]): DailyReportInput {
  return {
    date: '2026-05-19',
    activityEvents: events,
    sessions: [],
    aiEvents: events.filter((e) => e.eventType === 'ai_prompt_submitted' || e.eventType === 'ai_task_completed' || e.eventType === 'ai_task_failed'),
    fileEvents: events.filter((e) => e.eventType === 'file_saved' || e.eventType === 'file_exported'),
    taskDurations: [],
  }
}

console.log('[smoke:workspace-activity-report] start\n')

console.log('Case 1: task-level progress evidence with risk')
const paperImageEvents = [
  makeEvent({
    eventType: 'ai_prompt_submitted',
    ts: '2026-05-19T09:00:00.000+08:00',
    payload: { featureName: '论文生成', promptSummary: '修复论文生成图片问题' },
  }),
  makeEvent({
    eventType: 'ai_task_completed',
    ts: '2026-05-19T09:03:00.000+08:00',
    durationMs: 180000,
    payload: { featureName: '论文生成', outputSummary: '更新 paperImagePreservation' },
  }),
  makeEvent({
    eventType: 'file_saved',
    ts: '2026-05-19T09:04:00.000+08:00',
    targetTitle: 'EmbeddedOfficeEnginePanel.tsx',
    payload: { fileName: 'EmbeddedOfficeEnginePanel.tsx' },
  }),
  makeEvent({
    eventType: 'error_occurred',
    ts: '2026-05-19T09:05:00.000+08:00',
    errorMessage: '图片 finalize 后消失',
  }),
]
const paperEvidence = buildProgressEvidence(makeInput(paperImageEvents), [])
const paperProgress = paperEvidence.tasks[0]?.inferredProgress ?? ''
assert(
  paperProgress.includes('论文生成链路图片保留问题继续推进，但 finalize 后图片消失仍是风险'),
  'summarizes paper image preservation as progress with remaining risk',
)
assert(!paperProgress.includes('调用 AI') && !paperProgress.includes('保存文件') && !paperProgress.includes('发生错误'), 'does not read like an operation log')
console.log()

console.log('Case 2: only session events produce no effective work report')
const sessionOnly = makeInput([
  makeEvent({ eventType: 'session_started' }),
  makeEvent({ eventType: 'session_ended', ts: '2026-05-19T09:10:00.000+08:00' }),
])
const sessionEvidence = buildProgressEvidence(sessionOnly, [])
const noEffectiveReport = createNoEffectiveActivityReport('2026-05-19', undefined, [])
assert(!sessionEvidence.hasEffectiveActivity, 'session_started/session_ended are filtered as low-value noise')
assert(noEffectiveReport.overview === '今日无有效工作记录', 'overview is no effective work record')
assert(noEffectiveReport.mainWork === '无' && noEffectiveReport.keyOutputs === '无' && noEffectiveReport.anomalies === '无', 'other compatible fields are 无')
console.log()

console.log('Case 3: prompt-only AI event is attempted, not completed')
const promptOnlyEvidence = buildProgressEvidence(makeInput([
  makeEvent({
    eventType: 'ai_prompt_submitted',
    payload: { featureName: '论文生成', promptSummary: '修复论文生成图片问题' },
  }),
]), [])
const promptOnlyProgress = promptOnlyEvidence.tasks[0]?.inferredProgress ?? ''
assert(promptOnlyProgress.includes('发起/尝试'), 'prompt-only progress uses attempted wording')
assert(!promptOnlyProgress.includes('形成阶段性成果'), 'prompt-only progress does not claim a finished outcome')
console.log()

console.log('Case 4: file_saved + ai_task_completed creates milestone and evidence')
const completedEvidence = buildProgressEvidence(makeInput([
  makeEvent({
    eventType: 'ai_task_completed',
    payload: { featureName: '工作日报', outputSummary: '将日报功能从事件罗列调整为进展总结' },
  }),
  makeEvent({
    eventType: 'file_saved',
    ts: '2026-05-19T09:05:00.000+08:00',
    targetTitle: 'workspaceActivityService.ts',
    payload: { fileName: 'workspaceActivityService.ts' },
  }),
]), [])
const completedTask = completedEvidence.tasks[0]
assert(completedTask?.hasCompletion === true, 'completed task has milestone signal')
assert((completedTask?.files ?? []).includes('workspaceActivityService.ts'), 'completed task keeps file evidence')
assert((completedTask?.inferredProgress ?? '').includes('形成阶段性成果'), 'completed task summarizes stage output')
console.log()

console.log('Case 5: detailedMarkdown uses progress report sections')
const mappedReport = buildDailyActivityReportFromProgressJson('2026-05-19', 'smoke-user', [], {
  overview: '今日推进了工作日报进展总结链路。',
  progressSummary: '• 工作日报链路从事件罗列推进到任务维度总结。',
  keyMilestones: '• 完成事件归并与兼容映射。',
  evidenceBasedDetails: '• 文件变更：workspaceActivityService.ts。',
  blockersAndRisks: '• finalize 后图片消失仍是风险。',
  aiContribution: '• AI 辅助归纳了进展证据。',
  communicationProgress: '无',
  timeAndEffort: '无耗时数据',
  nextFocus: '• 继续处理图片 finalize 后丢失风险。',
})
assert(mappedReport.mainWork === mappedReport.progressSummary, 'mainWork maps to progressSummary')
assert(mappedReport.keyOutputs === mappedReport.keyMilestones, 'keyOutputs maps to keyMilestones')
assert(mappedReport.fileOutputs === mappedReport.evidenceBasedDetails, 'fileOutputs maps to evidenceBasedDetails')
assert(mappedReport.anomalies === mappedReport.blockersAndRisks, 'anomalies maps to blockersAndRisks')
assert(mappedReport.suggestions === mappedReport.nextFocus, 'suggestions maps to nextFocus')
assert(mappedReport.detailedMarkdown?.includes('## 工作进展') === true, 'detailedMarkdown contains 工作进展')
assert(mappedReport.detailedMarkdown?.includes('## 阻塞与风险') === true, 'detailedMarkdown contains 阻塞与风险')
assert(mappedReport.detailedMarkdown?.includes('## 下一步焦点') === true, 'detailedMarkdown contains 下一步焦点')
console.log()

async function runJsonScanningCases(): Promise<void> {
  console.log('Case 6: paper aidoc JSON scanning and evidence grouping')
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-office-workspace-activity-'))
  try {
    const documentsDir = path.join(tmpDir, 'documents')
    await fs.mkdir(documentsDir, { recursive: true })
    await fs.writeFile(path.join(documentsDir, '碳化硅研究论文.aidoc.json'), JSON.stringify({
      metadata: { generatedBy: 'paper-generation' },
      blocks: [
        { type: 'heading', text: '碳化硅功率器件研究进展' },
        { type: 'paragraph', text: '本文补充了碳化硅器件可靠性分析和实验讨论。' },
      ],
    }), 'utf-8')
    await fs.writeFile(path.join(documentsDir, '碳化硅研究论文.references.json'), JSON.stringify({
      references: [{ title: 'SiC device reliability' }],
    }), 'utf-8')
    await fs.writeFile(path.join(documentsDir, 'package.json'), '{"private":true}', 'utf-8')
    await fs.writeFile(path.join(documentsDir, 'normal.config.json'), '{"theme":"dark"}', 'utf-8')
    await fs.writeFile(path.join(documentsDir, 'cache-state.json'), '{"items":[]}', 'utf-8')

    const snapshot = await takeSnapshot(tmpDir)
    const relPaths = snapshot.files.map((file) => file.relativePath)
    assert(relPaths.includes('documents/碳化硅研究论文.aidoc.json'), 'documents/碳化硅研究论文.aidoc.json is scanned')
    assert(!relPaths.includes('documents/碳化硅研究论文.references.json'), 'references JSON is not scanned as a core file output')
    assert(!relPaths.includes('documents/package.json'), 'package.json is not scanned into report work files')
    assert(!relPaths.includes('documents/normal.config.json'), 'ordinary config JSON is not scanned into report work files')
    assert(!relPaths.includes('documents/cache-state.json'), 'cache JSON is not scanned into report work files')

    const paperSummary: FileContentSummary = {
      filePath: path.join(documentsDir, '碳化硅研究论文.aidoc.json'),
      fileName: '碳化硅研究论文.aidoc.json',
      changeType: 'modified',
      workType: 'formal',
      taskName: '碳化硅研究论文',
      topic: '碳化硅功率器件研究论文',
      progressStage: 'editing',
      progressDelta: '碳化硅研究论文从初稿推进到可靠性分析补充。',
      summary: '补充了碳化硅器件可靠性分析和实验讨论。',
      keyActions: ['补充可靠性分析'],
      outputValue: '形成论文主文稿阶段性更新',
      remainingIssues: [],
      evidence: ['文件名：碳化硅研究论文.aidoc.json', 'metadata.generatedBy=paper-generation'],
      outcomeLevel: 'substantial',
      confidence: 0.9,
    }
    const jsonEvidence = buildProgressEvidence(makeInput([
      makeEvent({
        eventType: 'file_saved',
        targetTitle: '碳化硅研究论文.references.json',
        payload: { fileName: '碳化硅研究论文.references.json' },
      }),
      makeEvent({
        eventType: 'file_saved',
        targetTitle: 'package.json',
        payload: { fileName: 'package.json' },
      }),
    ]), [paperSummary])
    const jsonTask = jsonEvidence.tasks.find((task) => task.taskName.includes('碳化硅研究论文'))
    assert(jsonTask != null, 'aidoc summary is grouped into the paper manuscript task')
    assert((jsonTask?.files ?? []).includes('碳化硅研究论文.aidoc.json'), 'aidoc JSON is kept as the core file output')
    assert(!(jsonTask?.files ?? []).includes('碳化硅研究论文.references.json'), 'references JSON is not kept as a core file output')
    assert((jsonTask?.evidence ?? []).some((item) => item.includes('references.json')), 'references JSON can remain as supporting evidence')
    assert(!jsonEvidence.tasks.some((task) => task.files.includes('package.json') || task.taskName.includes('package.json')), 'package.json does not create main report work')
    console.log()
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

runJsonScanningCases()
  .then(() => {
    if (failed > 0) {
      console.error(`[smoke:workspace-activity-report] failed: ${failed}, passed: ${passed}`)
      process.exit(1)
    }
    console.log(`[smoke:workspace-activity-report] passed: ${passed}`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
