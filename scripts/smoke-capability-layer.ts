/**
 * Core Capability 层冒烟测试（不启动 Electron UI）
 *
 * 运行: npx tsx scripts/smoke-capability-layer.ts
 */
import {
  CAPABILITY_CATALOG,
  getCatalogEntry,
  isCapabilityId,
  listCatalogEntries,
  validateCapabilityInvoke,
  validateManifestCapabilities,
} from '../src/capabilities'

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

console.log('[smoke-capability-layer] start\n')

// 1. catalog 能列出全部 capability
const all = listCatalogEntries()
assert(all.length === CAPABILITY_CATALOG.entries.length, 'catalog 条目数与 CAPABILITY_CATALOG 一致')
assert(all.length === 31, `catalog 共 31 项（实际 ${all.length}）`)

// 2. llm.generate 是合法 capability
assert(isCapabilityId('llm.generate'), 'llm.generate 是合法 capability')

// 3. document.updateBlock 是非法 capability
assert(!isCapabilityId('document.updateBlock'), 'document.updateBlock 是非法 capability')

// 4. deck.importPptx 是非法 capability
assert(!isCapabilityId('deck.importPptx'), 'deck.importPptx 是非法 capability')

// 5. pptx.import 是合法但 restricted
const pptxImport = getCatalogEntry('pptx.import')
assert(isCapabilityId('pptx.import'), 'pptx.import 是合法 capability id')
assert(pptxImport?.implementationStatus === 'restricted', 'pptx.import 为 restricted')
assert(pptxImport?.skillCallable === 'forbidden', 'pptx.import skillCallable 为 forbidden')

// 6. Template Skill 声明 pptx.import 返回错误
const templatePptx = validateManifestCapabilities({
  requiredCapabilities: ['pptx.import', 'deck.render'],
  skillKind: 'template',
  callerType: 'skill',
})
assert(!templatePptx.ok, 'Template + pptx.import manifest 校验失败')
assert(
  templatePptx.errors.some((e) => e.code === 'RESTRICTED_FOR_SKILL' && e.capability === 'pptx.import'),
  'Template + pptx.import 含 RESTRICTED_FOR_SKILL',
)

// 6b. runtime.writeLog：forbidden，任意 Skill 不得声明
const writeLogEntry = getCatalogEntry('runtime.writeLog')
assert(writeLogEntry?.implementationStatus === 'restricted', 'runtime.writeLog 为 restricted')
assert(writeLogEntry?.skillCallable === 'forbidden', 'runtime.writeLog skillCallable 为 forbidden')
assert(
  writeLogEntry?.notes === 'Skill 不得声明；由 Agent / Runtime 自动写日志',
  'runtime.writeLog notes 正确',
)

const templateWriteLog = validateManifestCapabilities({
  requiredCapabilities: ['runtime.writeLog'],
  skillKind: 'template',
  callerType: 'skill',
})
assert(!templateWriteLog.ok, 'Template + runtime.writeLog manifest 校验失败')
assert(
  templateWriteLog.errors.some((e) => e.code === 'RESTRICTED_FOR_SKILL' && e.capability === 'runtime.writeLog'),
  'Template + runtime.writeLog 含 RESTRICTED_FOR_SKILL',
)

const workflowWriteLog = validateManifestCapabilities({
  requiredCapabilities: ['runtime.writeLog'],
  skillKind: 'workflow',
  callerType: 'skill',
})
assert(!workflowWriteLog.ok, 'Workflow + runtime.writeLog manifest 校验失败')
assert(
  workflowWriteLog.errors.some((e) => e.code === 'RESTRICTED_FOR_SKILL' && e.capability === 'runtime.writeLog'),
  'Workflow + runtime.writeLog 含 RESTRICTED_FOR_SKILL',
)

// 7. Workflow Skill 声明 planned 能力返回 warning 而非 error
const workflowPlanned = validateManifestCapabilities({
  requiredCapabilities: ['llm.generateJson', 'document.applyPatch'],
  skillKind: 'workflow',
  callerType: 'skill',
})
assert(workflowPlanned.ok, 'Workflow + planned capabilities 无 error')
assert(
  workflowPlanned.warnings.some((w) => w.code === 'PLANNED_DECLARED'),
  'Workflow + planned 含 PLANNED_DECLARED warning',
)

// 8. Agent Action exportDeckToUserPath 返回 UNKNOWN_CAPABILITY
const agentAction = validateManifestCapabilities({
  requiredCapabilities: ['exportDeckToUserPath'],
  skillKind: 'workflow',
  callerType: 'agent',
})
assert(!agentAction.ok, 'Agent Action 字符串校验失败')
assert(
  agentAction.errors.some((e) => e.code === 'UNKNOWN_CAPABILITY'),
  'exportDeckToUserPath → UNKNOWN_CAPABILITY',
)

// 9. 第一批 invokeEnabled=true
for (const id of ['deck.load', 'deck.save', 'deck.render', 'deck.preview', 'deckTemplate.list'] as const) {
  const entry = getCatalogEntry(id)
  assert(entry?.invokeEnabled === true, `${id} invokeEnabled=true`)
  assert(entry?.invokeBatch === 'batch-1-deck', `${id} invokeBatch=batch-1-deck`)
}

// 10. 暂缓 invoke 能力 invokeEnabled=false
for (const id of ['document.applyPatch', 'docx.writeback', 'documentTemplate.validate'] as const) {
  const entry = getCatalogEntry(id)
  assert(entry?.invokeEnabled === false, `${id} invokeEnabled=false`)
}

// 11. validateCapabilityInvoke 错误码优先级
const pptxImportInvoke = validateCapabilityInvoke('pptx.import', 'skill')
assert(!pptxImportInvoke.ok && pptxImportInvoke.code === 'RESTRICTED_FOR_SKILL', 'pptx.import skill invoke → RESTRICTED_FOR_SKILL')

const writeLogInvoke = validateCapabilityInvoke('runtime.writeLog', 'skill')
assert(!writeLogInvoke.ok && writeLogInvoke.code === 'RESTRICTED_FOR_SKILL', 'runtime.writeLog skill invoke → RESTRICTED_FOR_SKILL')

const applyPatchInvoke = validateCapabilityInvoke('document.applyPatch', 'skill')
assert(!applyPatchInvoke.ok && applyPatchInvoke.code === 'PLANNED_NOT_INVOKABLE', 'document.applyPatch skill invoke → PLANNED_NOT_INVOKABLE')

console.log(`\n[smoke-capability-layer] done: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
