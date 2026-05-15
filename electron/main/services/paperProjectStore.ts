/**
 * PaperProject Store — 分步论文生成会话状态管理
 *
 * 解决的问题：`generatePaperNFTCORE()` 的所有中间状态（大纲、文献、已生成内容）
 * 原本是函数内局部变量。分步模式需要跨 IPC 调用持久化这些状态，
 * 本模块提供内存级的 project store 来承载。
 */

import { randomUUID } from 'node:crypto'
import type { ReferenceItem } from './openAlexClient'
import type { PaperPlan, SectionPlan } from './paperStructurePlanner'
import type { PaperGenerationParams } from './paperGeneratorNFTCORE'

// ── Section status ─────────────────────────────────────────────────────────

export type SectionStatus = 'pending' | 'running' | 'done' | 'error'

export interface ProjectSection {
  /** 对应 paperPlan.sections[index] */
  plan: SectionPlan
  status: SectionStatus
  /** LLM 写作思路（thinking pass 的结果） */
  thinking: string
  /** 生成的正文 markdown（不含 ## 标题行） */
  content: string
  /** 生成时捕获的错误 */
  error?: string
  /** 该节已生成的图片 */
  figures: Array<{ path: string; caption: string; markdown: string; url: string }>
}

// ── Project status ─────────────────────────────────────────────────────────

export type ProjectStatus =
  | 'init'          // 刚创建，还没做任何生成
  | 'initializing'  // 文献检索 + 章节规划进行中
  | 'outline_ready' // 大纲已就绪，可以开始逐节生成
  | 'partial'       // 部分章节已生成
  | 'finalizing'    // 最终引用整理 + 全文审查进行中
  | 'complete'      // 全文生成完毕

// ── PaperProject ──────────────────────────────────────────────────────────

export interface PaperProject {
  id: string
  createdAt: string
  updatedAt: string
  status: ProjectStatus

  /** 生成参数（主题、论文类型、语言等） */
  params: PaperGenerationParams

  /** 文献检索结果 */
  references: ReferenceItem[]
  /** 经过引用整理后的文献列表（引用编号对应 [1][2]...） */
  organizedReferences: ReferenceItem[]

  /** LLM 动态生成的论文章节计划 */
  paperPlan: PaperPlan | null

  /** 生成的标题（不含 # 前缀） */
  title: string
  /** 生成的摘要文本（不含 ## 摘要 heading） */
  abstract: string

  /** 各章节生成状态，顺序与 paperPlan.sections 一一对应 */
  sections: ProjectSection[]

  /** 结论章节 */
  conclusion: {
    status: SectionStatus
    thinking: string
    content: string
    error?: string
  }

  /**
   * 当前已组装的全文 markdown（累积追加）。
   * 每节生成完成后追加，作为后续章节 prompt 的"前文上下文"。
   */
  assembledMarkdown: string

  /** 生成过程中工作区的输出目录 */
  outputDir: string
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createPaperProject(params: PaperGenerationParams, outputDir: string): PaperProject {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'init',
    params,
    references: [],
    organizedReferences: [],
    paperPlan: null,
    title: '',
    abstract: '',
    sections: [],
    conclusion: { status: 'pending', thinking: '', content: '' },
    assembledMarkdown: '',
    outputDir,
  }
}

// ── In-memory Store ────────────────────────────────────────────────────────

const store = new Map<string, PaperProject>()

/** 创建并保存新 project，返回其 id */
export function storeCreateProject(params: PaperGenerationParams, outputDir: string): PaperProject {
  const project = createPaperProject(params, outputDir)
  store.set(project.id, project)
  return project
}

/** 读取 project（不存在返回 null） */
export function storeGetProject(id: string): PaperProject | null {
  return store.get(id) ?? null
}

/** 以 updater 函数原子更新 project，自动刷新 updatedAt */
export function storeUpdateProject(id: string, updater: (project: PaperProject) => PaperProject): PaperProject | null {
  const existing = store.get(id)
  if (!existing) return null
  const next: PaperProject = {
    ...updater(existing),
    updatedAt: new Date().toISOString(),
  }
  store.set(id, next)
  return next
}

/** 删除 project */
export function storeDeleteProject(id: string): boolean {
  return store.delete(id)
}

/** 列出所有 project（调试用） */
export function storeListProjects(): PaperProject[] {
  return Array.from(store.values())
}

// ── Section helpers ────────────────────────────────────────────────────────

/** 从 paperPlan 初始化 sections 数组 */
export function initSectionsFromPlan(plan: PaperPlan): ProjectSection[] {
  return plan.sections.map((sectionPlan) => ({
    plan: sectionPlan,
    status: 'pending',
    thinking: '',
    content: '',
    figures: [],
  }))
}
