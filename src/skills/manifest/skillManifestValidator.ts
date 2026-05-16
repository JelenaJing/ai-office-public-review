import fs from 'node:fs'
import path from 'node:path'
import {
  getCatalogEntry,
  isCapabilityId,
  validateManifestCapabilities,
} from '../../capabilities'
import {
  SKILL_MANIFEST_PERMISSION_ALLOWLIST,
  SKILL_MANIFEST_PERMISSION_DENYLIST,
  SKILL_MANIFEST_SCHEMA_VERSION,
  type ParseSkillManifestJsonResult,
  type SkillDomain,
  type SkillKind,
  type SkillManifest,
  type SkillManifestValidationIssue,
  type SkillManifestValidationResult,
  type ValidateSkillManifestOptions,
} from './skillManifestTypes'

const SKILL_ID_PATTERN = /^[a-z0-9._-]+$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

const SKILL_KINDS = new Set<SkillKind>(['template', 'workflow', 'style', 'adapter'])
const SKILL_DOMAINS = new Set<SkillDomain>([
  'document',
  'ppt',
  'email',
  'image',
  'excel',
  'general',
])

const PERMISSION_ALLOW_SET = new Set<string>(SKILL_MANIFEST_PERMISSION_ALLOWLIST)
const PERMISSION_DENY_SET = new Set<string>(SKILL_MANIFEST_PERMISSION_DENYLIST)

function issue(
  severity: SkillManifestValidationIssue['severity'],
  code: string,
  message: string,
  issuePath?: string,
): SkillManifestValidationIssue {
  return { severity, code, message, path: issuePath }
}

function pushIssue(
  target: SkillManifestValidationIssue[],
  item: SkillManifestValidationIssue,
): void {
  target.push(item)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRelativeAssetPath(
  value: string,
  issuePath: string,
  errors: SkillManifestValidationIssue[],
): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    pushIssue(errors, issue('error', 'INVALID_ASSET_PATH', '路径不能为空', issuePath))
    return false
  }

  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    pushIssue(errors, issue('error', 'ABSOLUTE_PATH_FORBIDDEN', '禁止使用绝对路径', issuePath))
    return false
  }

  if (trimmed.includes('..')) {
    pushIssue(errors, issue('error', 'PATH_TRAVERSAL_FORBIDDEN', '禁止包含 ..', issuePath))
    return false
  }

  if (/^file:\/\//i.test(trimmed)) {
    pushIssue(errors, issue('error', 'FILE_URL_FORBIDDEN', '禁止使用 file://', issuePath))
    return false
  }

  if (/^https?:\/\//i.test(trimmed)) {
    pushIssue(errors, issue('error', 'REMOTE_URL_FORBIDDEN', '禁止使用 http(s)://', issuePath))
    return false
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    pushIssue(errors, issue('error', 'ABSOLUTE_PATH_FORBIDDEN', '禁止以 / 或 \\ 开头的路径', issuePath))
    return false
  }

  return true
}

function checkPathExists(skillDir: string, relativePath: string, issuePath: string, errors: SkillManifestValidationIssue[]): void {
  const resolved = path.resolve(skillDir, relativePath)
  const root = path.resolve(skillDir)
  if (!resolved.startsWith(root)) {
    pushIssue(errors, issue('error', 'PATH_TRAVERSAL_FORBIDDEN', '解析路径超出 Skill 包目录', issuePath))
    return
  }
  if (!fs.existsSync(resolved)) {
    pushIssue(errors, issue('error', 'ASSET_NOT_FOUND', `文件不存在: ${relativePath}`, issuePath))
  }
}

function mergeCapabilityValidation(
  capResult: ReturnType<typeof validateManifestCapabilities>,
  errors: SkillManifestValidationIssue[],
  warnings: SkillManifestValidationIssue[],
  pathPrefix = 'requiredCapabilities',
): void {
  for (const err of capResult.errors) {
    pushIssue(
      errors,
      issue('error', err.code, err.message, `${pathPrefix}[${err.capability}]`),
    )
  }
  for (const warn of capResult.warnings) {
    pushIssue(
      warnings,
      issue('warning', warn.code, warn.message, `${pathPrefix}[${warn.capability}]`),
    )
  }
}

function validateWorkflowSteps(
  manifest: SkillManifest,
  errors: SkillManifestValidationIssue[],
  warnings: SkillManifestValidationIssue[],
): void {
  const steps = manifest.workflow?.steps
  if (!steps) return

  if (manifest.kind !== 'workflow') {
    pushIssue(
      warnings,
      issue('warning', 'WORKFLOW_ON_NON_WORKFLOW_KIND', `kind=${manifest.kind} 时包含 workflow.steps`, 'workflow.steps'),
    )
  }

  if (manifest.kind === 'template') {
    pushIssue(
      warnings,
      issue('warning', 'WORKFLOW_ON_TEMPLATE', 'Template Skill 不应包含 workflow.steps', 'workflow.steps'),
    )
  }

  const requiredSet = new Set(manifest.requiredCapabilities)

  steps.forEach((step, index) => {
    const stepPath = `workflow.steps[${index}]`
    if (!step || typeof step !== 'object') {
      pushIssue(errors, issue('error', 'INVALID_WORKFLOW_STEP', '步骤必须是对象', stepPath))
      return
    }

    const stepId = typeof step.id === 'string' ? step.id.trim() : ''
    if (!stepId) {
      pushIssue(errors, issue('error', 'MISSING_WORKFLOW_STEP_ID', '步骤缺少 id', `${stepPath}.id`))
    }

    const capability = typeof step.capability === 'string' ? step.capability.trim() : ''
    if (!capability) {
      pushIssue(errors, issue('error', 'MISSING_STEP_CAPABILITY', '步骤缺少 capability', `${stepPath}.capability`))
      return
    }

    if (!requiredSet.has(capability)) {
      pushIssue(
        errors,
        issue(
          'error',
          'STEP_CAPABILITY_NOT_DECLARED',
          `步骤 capability "${capability}" 未在 requiredCapabilities 中声明`,
          `${stepPath}.capability`,
        ),
      )
    }

    if (!isCapabilityId(capability)) {
      pushIssue(errors, issue('error', 'UNKNOWN_CAPABILITY', `未知 capability: ${capability}`, `${stepPath}.capability`))
      return
    }

    const catalogEntry = getCatalogEntry(capability)
    if (!catalogEntry) return

    if (catalogEntry.skillCallable === 'forbidden') {
      pushIssue(
        errors,
        issue('error', 'RESTRICTED_FOR_SKILL', catalogEntry.notes || '步骤禁止 forbidden capability', `${stepPath}.capability`),
      )
    }

    if (catalogEntry.implementationStatus === 'restricted') {
      pushIssue(
        errors,
        issue('error', 'RESTRICTED_FOR_SKILL', catalogEntry.notes || '步骤禁止 restricted capability', `${stepPath}.capability`),
      )
    }

    if (Array.isArray(step.capabilities)) {
      for (const extra of step.capabilities) {
        const extraId = String(extra || '').trim()
        if (!extraId) continue
        if (!requiredSet.has(extraId)) {
          pushIssue(
            errors,
            issue(
              'error',
              'STEP_CAPABILITY_NOT_DECLARED',
              `步骤 capabilities[] 中的 "${extraId}" 未在 requiredCapabilities 中声明`,
              `${stepPath}.capabilities`,
            ),
          )
        }
      }
    }
  })
}

export function parseSkillManifestJson(raw: string): ParseSkillManifestJsonResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return { ok: false, errors: ['manifest 必须是 JSON 对象'] }
    }
    return { ok: true, manifest: parsed as unknown as SkillManifest }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [`JSON 解析失败: ${message}`] }
  }
}

export function validateSkillManifest(
  manifestInput: unknown,
  options: ValidateSkillManifestOptions = {},
): SkillManifestValidationResult {
  const errors: SkillManifestValidationIssue[] = []
  const warnings: SkillManifestValidationIssue[] = []

  if (!isRecord(manifestInput)) {
    return {
      ok: false,
      errors: [issue('error', 'INVALID_MANIFEST', 'manifest 必须是对象')],
      warnings: [],
    }
  }

  const manifest = manifestInput as unknown as SkillManifest

  if (manifest.schemaVersion !== SKILL_MANIFEST_SCHEMA_VERSION) {
    pushIssue(
      errors,
      issue(
        'error',
        'INVALID_SCHEMA_VERSION',
        `schemaVersion 必须为 ${SKILL_MANIFEST_SCHEMA_VERSION}`,
        'schemaVersion',
      ),
    )
  }

  const skillId = typeof manifest.skillId === 'string' ? manifest.skillId.trim() : ''
  if (!skillId) {
    pushIssue(errors, issue('error', 'MISSING_SKILL_ID', 'skillId 必填', 'skillId'))
  } else if (!SKILL_ID_PATTERN.test(skillId)) {
    pushIssue(
      errors,
      issue('error', 'INVALID_SKILL_ID', 'skillId 仅允许小写字母、数字、点、下划线、短横线', 'skillId'),
    )
  }

  const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  if (!name) {
    pushIssue(errors, issue('error', 'MISSING_NAME', 'name 必填', 'name'))
  }

  const version = typeof manifest.version === 'string' ? manifest.version.trim() : ''
  if (!version) {
    pushIssue(errors, issue('error', 'MISSING_VERSION', 'version 必填', 'version'))
  } else if (!SEMVER_PATTERN.test(version)) {
    pushIssue(
      warnings,
      issue('warning', 'VERSION_NOT_SEMVER', '建议 version 使用 semver 格式，如 1.0.0', 'version'),
    )
  }

  const kind = manifest.kind
  if (!kind || !SKILL_KINDS.has(kind)) {
    pushIssue(errors, issue('error', 'INVALID_KIND', 'kind 必须是 template / workflow / style / adapter', 'kind'))
  }

  const domain = manifest.domain
  if (!domain || !SKILL_DOMAINS.has(domain)) {
    pushIssue(
      errors,
      issue('error', 'INVALID_DOMAIN', 'domain 必须是 document / ppt / email / image / excel / general', 'domain'),
    )
  }

  if (!Array.isArray(manifest.requiredCapabilities)) {
    pushIssue(errors, issue('error', 'INVALID_REQUIRED_CAPABILITIES', 'requiredCapabilities 必须是数组', 'requiredCapabilities'))
  } else if (kind && SKILL_KINDS.has(kind)) {
    mergeCapabilityValidation(
      validateManifestCapabilities({
        requiredCapabilities: manifest.requiredCapabilities.map(String),
        skillKind: kind,
        callerType: 'skill',
      }),
      errors,
      warnings,
    )
  }

  if (Array.isArray(manifest.permissions)) {
    for (let i = 0; i < manifest.permissions.length; i += 1) {
      const perm = String(manifest.permissions[i] || '').trim()
      const permPath = `permissions[${i}]`
      if (!perm) continue
      if (PERMISSION_DENY_SET.has(perm)) {
        pushIssue(errors, issue('error', 'PERMISSION_FORBIDDEN', `禁止的权限: ${perm}`, permPath))
      } else if (!PERMISSION_ALLOW_SET.has(perm)) {
        pushIssue(errors, issue('error', 'PERMISSION_UNKNOWN', `未在白名单中的权限: ${perm}`, permPath))
      }
    }
  }

  const validatePathMap = (
    map: Record<string, string> | undefined,
    mapName: string,
  ): void => {
    if (!map || !isRecord(map)) return
    for (const [key, value] of Object.entries(map)) {
      const issuePath = `${mapName}.${key}`
      if (typeof value !== 'string') {
        pushIssue(errors, issue('error', 'INVALID_PATH_VALUE', '路径值必须是字符串', issuePath))
        continue
      }
      if (validateRelativeAssetPath(value, issuePath, errors) && options.skillDir) {
        checkPathExists(options.skillDir, value.trim(), issuePath, errors)
      }
    }
  }

  validatePathMap(manifest.assets, 'assets')
  validatePathMap(manifest.prompts, 'prompts')

  if (manifest.workflow !== undefined) {
    if (!isRecord(manifest.workflow) || !Array.isArray(manifest.workflow.steps)) {
      pushIssue(errors, issue('error', 'INVALID_WORKFLOW', 'workflow.steps 必须是数组', 'workflow'))
    } else {
      validateWorkflowSteps(manifest, errors, warnings)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}
