// ---------------------------------------------------------------------------
// templateProfileService.ts — 模板画像持久化服务
// ---------------------------------------------------------------------------
// 职责：创建、加载、更新、持久化 TemplateProfile。
//       Profile 是正式模板链路中的"任务上下文"，串联所有阶段。
//       存储为 JSON 文件，放在工作副本同目录下。
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises'
import path from 'node:path'
import type { TemplateProfile, FieldSchema, TemplateRegion, FieldValue } from '../../../../src/types/templateGeneration'
import type { OoxmlPackageSnapshot } from '../documentEngineService'
import type { KnowledgeDocumentCategory } from '../../../../src/types/knowledge'

function normalizeProfilePath(filePath: string): string {
  return path.resolve(filePath)
}

// ---- 公共 API ----

/**
 * createProfile — 根据准入结果和解析产出创建新的 TemplateProfile
 */
export function createProfile(params: {
  knowledgeDocumentId: string
  workCopyPath: string
  sourceType: 'docx' | 'doc'
  title: string
  documentCategory?: KnowledgeDocumentCategory
  fields: FieldSchema[]
  regions: TemplateRegion[]
  totalBlockCount: number
  routingPlan?: TemplateProfile['routingPlan']
}): TemplateProfile {
  const now = new Date().toISOString()
  return {
    profileId: `ftp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    knowledgeDocumentId: params.knowledgeDocumentId,
    workCopyPath: params.workCopyPath,
    sourceType: params.sourceType,
    documentCategory: params.documentCategory,
    title: params.title,
    isFormalTemplate: true,
    shellLocked: true,
    requireOoxmlWrite: true,
    allowFallback: false,
    fields: params.fields,
    regions: params.regions,
    totalBlockCount: params.totalBlockCount,
    routingPlan: params.routingPlan,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * saveProfile — 将 TemplateProfile 序列化到磁盘
 * 文件路径：与 workCopyPath 同目录，文件名为 `{profileId}.profile.json`
 */
export async function saveProfile(profile: TemplateProfile): Promise<string> {
  const dir = path.dirname(profile.workCopyPath)
  const filePath = path.join(dir, `${profile.profileId}.profile.json`)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8')
  return filePath
}

/**
 * loadProfile — 从磁盘反序列化 TemplateProfile
 */
export async function loadProfile(profilePath: string): Promise<TemplateProfile> {
  const raw = await fs.readFile(profilePath, 'utf-8')
  return JSON.parse(raw) as TemplateProfile
}

/**
 * loadProfileByWorkCopy — 根据 workCopyPath 目录扫描找到 profile
 */
export async function loadProfileByWorkCopy(workCopyPath: string, expectedProfileId?: string): Promise<TemplateProfile | null> {
  const dir = path.dirname(workCopyPath)
  const normalizedWorkCopyPath = normalizeProfilePath(workCopyPath)

  try {
    const entries = await fs.readdir(dir)
    const profileFiles = entries.filter((entry) => entry.endsWith('.profile.json'))
    if (profileFiles.length === 0) return null

    if (expectedProfileId) {
      const exactProfileFile = `${expectedProfileId}.profile.json`
      if (profileFiles.includes(exactProfileFile)) {
        const exactProfile = await loadProfile(path.join(dir, exactProfileFile))
        if (normalizeProfilePath(exactProfile.workCopyPath) === normalizedWorkCopyPath) {
          return exactProfile
        }
      }
    }

    const matchedProfiles: TemplateProfile[] = []
    for (const profileFile of profileFiles) {
      const profile = await loadProfile(path.join(dir, profileFile))
      if (normalizeProfilePath(profile.workCopyPath) !== normalizedWorkCopyPath) continue
      if (expectedProfileId && profile.profileId === expectedProfileId) return profile
      matchedProfiles.push(profile)
    }

    if (matchedProfiles.length === 0) return null

    matchedProfiles.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0
      const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0
      return rightTime - leftTime
    })

    return matchedProfiles[0]
  } catch {
    return null
  }
}

/**
 * updateProfile — 更新 profile 并重新持久化
 */
export async function updateProfile(
  profile: TemplateProfile,
  patch: Partial<Pick<TemplateProfile, 'fields' | 'regions' | 'totalBlockCount' | 'documentCategory' | 'title' | 'routingPlan'>>,
): Promise<TemplateProfile> {
  const updated: TemplateProfile = {
    ...profile,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await saveProfile(updated)
  return updated
}

/**
 * applyFieldValuesToProfile — 将用户确认的字段值合并进 profile.fields 的 sampleValues
 * （不修改 FieldSchema 本身，只追踪已填状态）
 */
export function mergeFieldValuesIntoProfile(
  profile: TemplateProfile,
  fieldValues: FieldValue[],
): TemplateProfile {
  const valueMap = new Map(fieldValues.map((fv) => [fv.fieldId, fv]))
  return {
    ...profile,
    fields: profile.fields.map((field: FieldSchema) => {
      const fv = valueMap.get(field.fieldId)
      if (!fv) return field
      return {
        ...field,
        defaultText: fv.confirmed ? fv.value : field.defaultText,
      }
    }),
    updatedAt: new Date().toISOString(),
  }
}
