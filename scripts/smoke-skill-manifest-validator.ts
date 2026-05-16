/**
 * Skill Manifest Validator 冒烟测试
 *
 * 运行: npx tsx scripts/smoke-skill-manifest-validator.ts
 */
import { validateSkillManifest } from '../src/skills/manifest'

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

const validPptTemplate = {
  schemaVersion: 'ai-office-skill-manifest-v1',
  skillId: 'ppt.template.business_report',
  name: '商务汇报 PPT 模板',
  version: '1.0.0',
  kind: 'template' as const,
  domain: 'ppt' as const,
  requiredCapabilities: ['deck.render', 'deck.preview', 'deckTemplate.list'],
  assets: {
    template: 'assets/template.pptx',
    preview: 'assets/preview.png',
  },
  permissions: ['deck.write', 'workspace.write'],
}

console.log('[smoke-skill-manifest-validator] start\n')

// A. 合法 PPT Template Skill
const caseA = validateSkillManifest(validPptTemplate)
assert(caseA.ok, 'A: 合法 PPT Template Skill 通过')
assert(caseA.errors.length === 0, 'A: 无 error')

// B. Template Skill 声明 pptx.import 失败
const caseB = validateSkillManifest({
  ...validPptTemplate,
  skillId: 'ppt.template.bad_import',
  requiredCapabilities: ['pptx.import', 'deck.render'],
})
assert(!caseB.ok, 'B: pptx.import 校验失败')
assert(
  caseB.errors.some((e) => e.code === 'RESTRICTED_FOR_SKILL' && e.path?.includes('pptx.import')),
  'B: 含 RESTRICTED_FOR_SKILL',
)

// C. Workflow + planned capabilities
const caseC = validateSkillManifest({
  schemaVersion: 'ai-office-skill-manifest-v1',
  skillId: 'doc.workflow.paper',
  name: '论文流程',
  version: '1.0.0',
  kind: 'workflow',
  domain: 'document',
  requiredCapabilities: ['llm.generateJson', 'document.applyPatch'],
})
assert(caseC.ok, 'C: Workflow planned capabilities 通过')
assert(
  caseC.warnings.some((w) => w.code === 'PLANNED_DECLARED'),
  'C: 含 PLANNED_DECLARED warning',
)
assert(
  !caseC.warnings.some((w) => w.code === 'WRAPPER_ONLY'),
  'C: 不含 WRAPPER_ONLY',
)

// D. Agent Action 字符串
const caseD = validateSkillManifest({
  ...validPptTemplate,
  skillId: 'ppt.template.agent_action',
  requiredCapabilities: ['exportDeckToUserPath'],
})
assert(!caseD.ok, 'D: exportDeckToUserPath 失败')
assert(
  caseD.errors.some((e) => e.code === 'UNKNOWN_CAPABILITY'),
  'D: UNKNOWN_CAPABILITY',
)

// E. 绝对路径 assets
const caseE = validateSkillManifest({
  ...validPptTemplate,
  skillId: 'ppt.template.abs_path',
  assets: { template: 'C:\\abc\\template.pptx' },
})
assert(!caseE.ok, 'E: 绝对路径 assets 失败')
assert(
  caseE.errors.some((e) => e.code === 'ABSOLUTE_PATH_FORBIDDEN'),
  'E: ABSOLUTE_PATH_FORBIDDEN',
)

// F. path traversal
const caseF = validateSkillManifest({
  ...validPptTemplate,
  skillId: 'ppt.template.traversal',
  assets: { secret: '../secret.env' },
})
assert(!caseF.ok, 'F: .. 路径失败')
assert(
  caseF.errors.some((e) => e.code === 'PATH_TRAVERSAL_FORBIDDEN'),
  'F: PATH_TRAVERSAL_FORBIDDEN',
)

// G. 禁止权限
const caseG = validateSkillManifest({
  ...validPptTemplate,
  skillId: 'ppt.template.bad_perm',
  permissions: ['shell.execute'],
})
assert(!caseG.ok, 'G: shell.execute 失败')
assert(
  caseG.errors.some((e) => e.code === 'PERMISSION_FORBIDDEN'),
  'G: PERMISSION_FORBIDDEN',
)

// H. workflow step 未声明 capability
const caseH = validateSkillManifest({
  schemaVersion: 'ai-office-skill-manifest-v1',
  skillId: 'ppt.workflow.missing_cap',
  name: '坏流程',
  version: '1.0.0',
  kind: 'workflow',
  domain: 'ppt',
  requiredCapabilities: ['deck.render'],
  workflow: {
    steps: [{ id: 'render', capability: 'deck.preview' }],
  },
})
assert(!caseH.ok, 'H: step capability 未声明失败')
assert(
  caseH.errors.some((e) => e.code === 'STEP_CAPABILITY_NOT_DECLARED'),
  'H: STEP_CAPABILITY_NOT_DECLARED',
)

// I. Template + workflow.steps → warning
const caseI = validateSkillManifest({
  ...validPptTemplate,
  skillId: 'ppt.template.with_workflow',
  requiredCapabilities: ['deck.render', 'deck.preview', 'deckTemplate.list'],
  workflow: {
    steps: [{ id: 'render', capability: 'deck.render' }],
  },
})
assert(caseI.ok, 'I: Template + workflow 仍为 ok')
assert(
  caseI.warnings.some((w) => w.code === 'WORKFLOW_ON_TEMPLATE'),
  'I: WORKFLOW_ON_TEMPLATE warning',
)

console.log(`\n[smoke-skill-manifest-validator] done: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
