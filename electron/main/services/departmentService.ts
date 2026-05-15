import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { KnowledgeService, type KnowledgeServiceOptions } from './knowledgeService'
import { KnowledgeRetrievalService } from './knowledgeRetrievalService'
import { KnowledgeTaskService } from './knowledgeTaskService'
import type { AppSettings } from './settingsStore'

// ---- Types ----

export interface Department {
  id: string
  name: string
  nameEn: string
  preset: boolean
  createdAt: string
  parentId?: string
}

export interface DepartmentRegistry {
  version: 1
  departments: Department[]
}

export interface DepartmentKnowledgeBundle {
  knowledgeService: KnowledgeService
  retrievalService: KnowledgeRetrievalService
  taskService: KnowledgeTaskService
}

// ---- Preset departments ----

export const PRESET_DEPARTMENTS: Omit<Department, 'createdAt'>[] = [
  { id: 'cuhksz', name: '香港中文大学深圳', nameEn: 'CUHK-Shenzhen', preset: true },
  { id: 'sai', name: 'SAI', nameEn: 'School of AI', preset: true, parentId: 'cuhksz' },
  { id: 'clear', name: 'CLEAR', nameEn: 'CLEAR', preset: true, parentId: 'cuhksz' },
  { id: 'bfmo', name: 'BFMO', nameEn: 'BFMO', preset: true, parentId: 'cuhksz' },
  { id: 'ai-reading', name: 'AI阅读中心', nameEn: 'AI Reading Center', preset: true, parentId: 'cuhksz' },
  { id: 'classic-reading', name: '经典文章', nameEn: 'Classic Articles', preset: true, parentId: 'ai-reading' },
  { id: 'scientific-papers', name: '科技论文', nameEn: 'Scientific Papers', preset: true, parentId: 'ai-reading' },
  { id: 'aso', name: 'ASO行政事务处', nameEn: 'Administrative Services Office', preset: true, parentId: 'cuhksz' },
  { id: 'zhaoban', name: '招生办', nameEn: 'Admissions Office', preset: true, parentId: 'cuhksz' },
  { id: 'cuhksz_course', name: '课程', nameEn: 'Course Knowledge Base', preset: true, parentId: 'cuhksz' },
]

// ---- DepartmentService ----

export class DepartmentService {
  private registry: DepartmentRegistry | null = null
  private readonly bundles = new Map<string, DepartmentKnowledgeBundle>()
  private settingsGetter?: () => Promise<AppSettings>
  private emitAiEvent?: (payload: Record<string, unknown>) => void

  constructor(
    private readonly knowledgeBaseRoot: string,
    private readonly knowledgeServiceOptions: KnowledgeServiceOptions = {},
  ) {}

  setSettingsGetter(getter: () => Promise<AppSettings>): void {
    this.settingsGetter = getter
  }

  setEmitAiEvent(emitter: (payload: Record<string, unknown>) => void): void {
    this.emitAiEvent = emitter
  }

  private get registryPath(): string {
    return path.join(this.knowledgeBaseRoot, 'departments.json')
  }

  private deptDir(departmentId: string): string {
    return path.join(this.knowledgeBaseRoot, `dept-${departmentId}`)
  }

  // ---- Initialize ----

  async initialize(): Promise<void> {
    await fs.mkdir(this.knowledgeBaseRoot, { recursive: true })
    this.registry = await this.readRegistry()

    // Auto-migrate: if legacy knowledge-base/index.json exists and no departments yet
    await this.migrateLegacyIfNeeded()
  }

  private async migrateLegacyIfNeeded(): Promise<void> {
    const legacyIndexPath = path.join(this.knowledgeBaseRoot, 'index.json')
    try {
      await fs.access(legacyIndexPath)
    } catch {
      return // no legacy data
    }

    const firstDept = this.registry!.departments[0]
    if (!firstDept) return

    const targetDir = this.deptDir(firstDept.id)
    try {
      await fs.access(path.join(targetDir, 'index.json'))
      return // target already has index.json, skip migration
    } catch {
      // proceed with migration
    }

    await fs.mkdir(targetDir, { recursive: true })

    // Move legacy files to first department directory
    const entries = await fs.readdir(this.knowledgeBaseRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'departments.json') continue
      if (entry.name.startsWith('dept-')) continue
      const src = path.join(this.knowledgeBaseRoot, entry.name)
      const dst = path.join(targetDir, entry.name)
      try {
        await fs.rename(src, dst)
      } catch {
        // if rename fails (cross-device), try copy+remove
        try {
          await fs.cp(src, dst, { recursive: true })
          await fs.rm(src, { recursive: true, force: true })
        } catch {
          // skip files that can't be moved
        }
      }
    }
  }

  private async readRegistry(): Promise<DepartmentRegistry> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as DepartmentRegistry
      if (parsed.version === 1 && Array.isArray(parsed.departments)) {
        // Ensure all presets exist
        const existingIds = new Set(parsed.departments.map((d) => d.id))
        for (const preset of PRESET_DEPARTMENTS) {
          if (!existingIds.has(preset.id)) {
            parsed.departments.push({ ...preset, createdAt: new Date().toISOString() })
          }
        }
        // Sync preset fields (parentId, name, nameEn) to existing departments
        const presetMap = new Map(PRESET_DEPARTMENTS.map((p) => [p.id, p]))
        for (const dept of parsed.departments) {
          const preset = presetMap.get(dept.id)
          if (!preset) continue
          dept.parentId = preset.parentId
          dept.name = preset.name
          dept.nameEn = preset.nameEn
        }
        return parsed
      }
    } catch {
      // file doesn't exist or is corrupted
    }

    // Create default registry
    const registry: DepartmentRegistry = {
      version: 1,
      departments: PRESET_DEPARTMENTS.map((d) => ({ ...d, createdAt: new Date().toISOString() })),
    }
    await this.writeRegistry(registry)
    return registry
  }

  private async writeRegistry(registry: DepartmentRegistry): Promise<void> {
    const tmpPath = this.registryPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(registry, null, 2), 'utf-8')
    await fs.rename(tmpPath, this.registryPath)
    this.registry = registry
  }

  // ---- CRUD ----

  listDepartments(): Department[] {
    return [...(this.registry?.departments ?? [])]
  }

  getDepartment(id: string): Department | null {
    return this.registry?.departments.find((d) => d.id === id) ?? null
  }

  async createDepartment(name: string, nameEn: string): Promise<Department> {
    const id = crypto.randomBytes(6).toString('hex')
    const dept: Department = {
      id,
      name: name.trim(),
      nameEn: nameEn.trim(),
      preset: false,
      createdAt: new Date().toISOString(),
    }
    const registry = this.registry ?? { version: 1 as const, departments: [] }
    registry.departments.push(dept)
    await this.writeRegistry(registry)
    // Create department directory
    await fs.mkdir(this.deptDir(id), { recursive: true })
    return dept
  }

  async renameDepartment(id: string, name: string, nameEn: string): Promise<Department> {
    const registry = this.registry ?? { version: 1 as const, departments: [] }
    const dept = registry.departments.find((d) => d.id === id)
    if (!dept) throw new Error(`Department not found: ${id}`)
    dept.name = name.trim()
    dept.nameEn = nameEn.trim()
    await this.writeRegistry(registry)
    return dept
  }

  async deleteDepartment(id: string): Promise<void> {
    const registry = this.registry ?? { version: 1 as const, departments: [] }
    const dept = registry.departments.find((d) => d.id === id)
    if (!dept) throw new Error(`Department not found: ${id}`)
    if (dept.preset) throw new Error(`Cannot delete preset department: ${id}`)

    // Move department directory to trash
    const deptPath = this.deptDir(id)
    const trashPath = path.join(this.knowledgeBaseRoot, 'trash', `dept-${id}-${Date.now()}`)
    try {
      await fs.mkdir(path.join(this.knowledgeBaseRoot, 'trash'), { recursive: true })
      await fs.rename(deptPath, trashPath)
    } catch {
      // if rename fails, just remove
      await fs.rm(deptPath, { recursive: true, force: true })
    }

    // Remove from registry
    registry.departments = registry.departments.filter((d) => d.id !== id)
    await this.writeRegistry(registry)

    // Clean up cached bundle
    this.bundles.delete(id)
  }

  // ---- Knowledge service management ----

  async getBundle(departmentId: string): Promise<DepartmentKnowledgeBundle> {
    const existing = this.bundles.get(departmentId)
    if (existing) return existing

    const dept = this.getDepartment(departmentId)
    if (!dept) throw new Error(`Department not found: ${departmentId}`)

    const deptPath = this.deptDir(departmentId)
    await fs.mkdir(deptPath, { recursive: true })

    const knowledgeService = new KnowledgeService(deptPath, this.knowledgeServiceOptions)
    await knowledgeService.initialize()
    await knowledgeService.importBundledSeedsIfNeeded()
    if (this.settingsGetter) {
      knowledgeService.setSettingsGetter(this.settingsGetter)
    }

    const retrievalService = new KnowledgeRetrievalService(knowledgeService)
    const taskService = new KnowledgeTaskService(
      knowledgeService,
      retrievalService,
      this.settingsGetter ?? (async () => ({} as AppSettings)),
      this.emitAiEvent ?? (() => {}),
    )

    const bundle: DepartmentKnowledgeBundle = {
      knowledgeService,
      retrievalService,
      taskService,
    }

    this.bundles.set(departmentId, bundle)
    return bundle
  }

  getDefaultDepartmentId(): string {
    return this.registry?.departments[0]?.id ?? 'ao'
  }
}
