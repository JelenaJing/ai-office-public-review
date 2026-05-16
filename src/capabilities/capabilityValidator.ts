import { getCatalogEntry, listCatalogEntries } from './capabilityCatalog'
import {
  AGENT_ACTION_DENYLIST,
  CAPABILITY_IDS,
  type CapabilityId,
  type ValidateManifestCapabilitiesInput,
  type ValidateManifestCapabilitiesResult,
} from './capabilityTypes'

const CAPABILITY_ID_SET = new Set<string>(CAPABILITY_IDS)

export function isCapabilityId(value: string): value is CapabilityId {
  return CAPABILITY_ID_SET.has(value)
}

export { getCatalogEntry, listCatalogEntries }

function pushError(
  errors: ValidateManifestCapabilitiesResult['errors'],
  capability: string,
  code: string,
  message: string,
): void {
  errors.push({ capability, code, message })
}

function pushWarning(
  warnings: ValidateManifestCapabilitiesResult['warnings'],
  capability: string,
  code: string,
  message: string,
): void {
  warnings.push({ capability, code, message })
}

/**
 * 校验 Skill manifest 中的 requiredCapabilities。
 * planned 能力可声明但产生 PLANNED_DECLARED 警告；restricted/forbidden 对 Skill 为 error。
 */
export function validateManifestCapabilities(
  input: ValidateManifestCapabilitiesInput,
): ValidateManifestCapabilitiesResult {
  const errors: ValidateManifestCapabilitiesResult['errors'] = []
  const warnings: ValidateManifestCapabilitiesResult['warnings'] = []
  const seen = new Set<string>()

  for (const raw of input.requiredCapabilities) {
    const capability = String(raw || '').trim()
    if (!capability) continue
    if (seen.has(capability)) continue
    seen.add(capability)

    if ((AGENT_ACTION_DENYLIST as readonly string[]).includes(capability)) {
      pushError(
        errors,
        capability,
        'UNKNOWN_CAPABILITY',
        `"${capability}" 是 Agent Action，不是 Core Capability id`,
      )
      continue
    }

    if (!isCapabilityId(capability)) {
      pushError(
        errors,
        capability,
        'UNKNOWN_CAPABILITY',
        `未知 capability: ${capability}`,
      )
      continue
    }

    const catalogEntry = getCatalogEntry(capability)
    if (!catalogEntry) {
      pushError(errors, capability, 'UNKNOWN_CAPABILITY', `Catalog 中未找到: ${capability}`)
      continue
    }

    if (catalogEntry.implementationStatus === 'deprecated') {
      pushWarning(
        warnings,
        capability,
        'DEPRECATED',
        catalogEntry.replaces?.length
          ? `已废弃，请改用: ${catalogEntry.replaces.join(', ')}`
          : '该 capability 已废弃',
      )
    }

    if (catalogEntry.implementationStatus === 'planned') {
      pushWarning(
        warnings,
        capability,
        'PLANNED_DECLARED',
        '能力尚未开放 invoke，仅可静态声明',
      )
    }

    if (catalogEntry.skillCallable === 'forbidden') {
      pushError(
        errors,
        capability,
        'RESTRICTED_FOR_SKILL',
        catalogEntry.notes || '该 capability 禁止 Skill 声明',
      )
      continue
    }

    if (
      catalogEntry.skillCallable === 'workflow-only'
      && input.skillKind === 'template'
    ) {
      pushError(
        errors,
        capability,
        'RESTRICTED_FOR_SKILL',
        'Template Skill 不得声明此 capability',
      )
      continue
    }

    if (
      catalogEntry.implementationStatus === 'restricted'
      && input.callerType === 'skill'
    ) {
      pushError(
        errors,
        capability,
        'RESTRICTED_FOR_SKILL',
        catalogEntry.notes || 'restricted capability 不得由 Skill 声明',
      )
      continue
    }

    // Template Skill 显式禁止（文档 §3.2）
    if (input.skillKind === 'template' && capability === 'pptx.import') {
      pushError(
        errors,
        capability,
        'RESTRICTED_FOR_SKILL',
        'Template Skill 不得声明 pptx.import',
      )
    }

    if (
      catalogEntry.implementationStatus === 'wrapper'
      && !catalogEntry.invokeEnabled
    ) {
      pushWarning(
        warnings,
        capability,
        'WRAPPER_ONLY',
        '当前未开放 invoke，仅登记依赖',
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}

/** invoke 前校验：Skill 不得调用 invokeEnabled=false / planned / restricted */
export function validateCapabilityInvoke(
  capabilityId: string,
  callerType: ValidateManifestCapabilitiesInput['callerType'],
): { ok: true } | { ok: false; code: string; message: string } {
  if ((AGENT_ACTION_DENYLIST as readonly string[]).includes(capabilityId)) {
    return { ok: false, code: 'UNKNOWN_CAPABILITY', message: `未知 capability: ${capabilityId}` }
  }

  if (!isCapabilityId(capabilityId)) {
    return { ok: false, code: 'UNKNOWN_CAPABILITY', message: `未知 capability: ${capabilityId}` }
  }

  const catalogEntry = getCatalogEntry(capabilityId)
  if (!catalogEntry) {
    return { ok: false, code: 'CAPABILITY_NOT_FOUND', message: `Catalog 中未找到: ${capabilityId}` }
  }

  if (catalogEntry.skillCallable === 'forbidden' && callerType === 'skill') {
    return {
      ok: false,
      code: 'RESTRICTED_FOR_SKILL',
      message: catalogEntry.notes || `${capabilityId} 禁止 Skill 调用`,
    }
  }

  if (catalogEntry.implementationStatus === 'restricted' && callerType === 'skill') {
    return {
      ok: false,
      code: 'RESTRICTED_FOR_SKILL',
      message: catalogEntry.notes || `${capabilityId} 仅 Agent 可调用`,
    }
  }

  if (catalogEntry.implementationStatus === 'planned') {
    return { ok: false, code: 'PLANNED_NOT_INVOKABLE', message: `${capabilityId} 尚未实现 invoke` }
  }

  if (!catalogEntry.invokeEnabled) {
    return { ok: false, code: 'CAPABILITY_NOT_INVOKABLE', message: `${capabilityId} 未开放 invoke` }
  }

  return { ok: true }
}
