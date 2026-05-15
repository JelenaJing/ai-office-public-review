// ---------------------------------------------------------------------------
// templateAdmissionService.ts — 正式模板准入服务
// ---------------------------------------------------------------------------
// 职责：校验一份知识库文档是否具备进入正式模板链路的资格。
//       包括：格式检查、.doc→.docx 兼容转换、基线壳层快照。
// 不允许 pdf / txt / md / image 进入正式模板链。
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises'
import path from 'node:path'
import type { OoxmlPackageSnapshot, OoxmlBlockSnapshot, OoxmlRenderMetaSnapshot } from '../documentEngineService'
import type { FormalTemplateErrorCode } from '../../../../src/types/templateGeneration'
import { prepareCompatibleDocxSource, cleanupPreparedCompatibleDocxSource, type PreparedCompatibleDocxSource } from '../wordDocumentCompatibility'

// ---- 公共类型 ----

/** 准入结果 */
export interface AdmissionResult {
  admitted: boolean
  /** 工作副本路径（admitted=true 时可用） */
  workCopyPath?: string
  /** 基线 OOXML 快照（admitted=true 时可用） */
  baselineSnapshot?: OoxmlPackageSnapshot
  /** 错误码 */
  errorCode?: FormalTemplateErrorCode
  /** 可读错误信息 */
  errorMessage?: string
}

/** 内部状态：兼容转换句柄，用于 cleanup */
let lastPrepared: PreparedCompatibleDocxSource | null = null

// ---- 对外 API ----

/**
 * admit — 校验并准备正式模板工作副本。
 *
 * @param sourcePath   知识库中原始文件的绝对路径
 * @param workDir      工作副本目标目录（通常是 workspace 下的子目录）
 * @param readOoxmlPackage  documentEngineService.readOoxmlPackage 的引用（依赖注入，不直接 import 实例）
 *
 * 步骤：
 *  1. 检查文件扩展名（只接受 .doc / .docx）
 *  2. 调 prepareCompatibleDocxSource 做兼容转换
 *  3. 将转换/原始 docx 复制到 workDir 下作为工作副本
 *  4. 对工作副本调 readOoxmlPackage 取基线快照
 *  5. 校验基线快照中至少有 1 个可用 block
 *  6. 返回 AdmissionResult
 */
export async function admit(
  sourcePath: string,
  workDir: string,
  readOoxmlPackage: (filePath: string) => Promise<OoxmlPackageSnapshot>,
): Promise<AdmissionResult> {
  const ext = path.extname(sourcePath).toLowerCase()
  if (ext !== '.doc' && ext !== '.docx') {
    return { admitted: false, errorCode: 'FT_ADMISSION_INVALID_FORMAT', errorMessage: `不支持的模板格式: ${ext}，仅接受 .doc / .docx` }
  }

  let prepared: PreparedCompatibleDocxSource | null = null

  try {
    // 兼容转换
    prepared = await prepareCompatibleDocxSource(sourcePath)
    lastPrepared = prepared

    // 创建工作副本
    await fs.mkdir(workDir, { recursive: true })
    const workCopyName = `formal-template-${Date.now()}.docx`
    const workCopyPath = path.join(workDir, workCopyName)
    await fs.copyFile(prepared.filePath, workCopyPath)

    // 取基线快照
    const baselineSnapshot = await readOoxmlPackage(workCopyPath)

    if (!baselineSnapshot.exists) {
      return { admitted: false, errorCode: 'FT_ADMISSION_INVALID_FORMAT', errorMessage: '工作副本读取失败，文件可能已损坏' }
    }

    if (baselineSnapshot.blockCount === 0) {
      return { admitted: false, errorCode: 'FT_ADMISSION_NO_REGIONS', errorMessage: '模板中未检测到任何段落或区域' }
    }

    return { admitted: true, workCopyPath, baselineSnapshot }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { admitted: false, errorCode: 'FT_ADMISSION_COMPATIBILITY_FAILED', errorMessage: message }
  } finally {
    await cleanupPreparedCompatibleDocxSource(prepared)
    lastPrepared = null
  }
}

/**
 * extractBaselineShellFingerprint — 从 OOXML 快照中提取壳层指纹。
 * 用于 commit 阶段的壳层校验基准。
 * 只取 region 外 blocks 的 sourceId + text + kind 作为指纹。
 */
export function extractBaselineShellFingerprint(
  blocks: OoxmlBlockSnapshot[],
  editableBlockIndices: Set<number>,
): Array<{ index: number; kind: string; textHash: string; sourceId?: string }> {
  return blocks
    .filter((_, i) => !editableBlockIndices.has(i))
    .map((block) => ({
      index: block.index,
      kind: block.kind,
      textHash: simpleHash(block.text),
      sourceId: block.sourceId,
    }))
}

// ---- 内部工具 ----

function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
