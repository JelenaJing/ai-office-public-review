import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'

export interface PlotAgentStatus {
  ready: boolean
  running: boolean
  baseUrl: string
  port: number
  pythonCommand: string | null
  agentRoot: string | null
  lastError?: string | null
}

export interface PlotRecommendationItem {
  chart_type: string
  confidence: number
  reasoning: string
  suggested_parameters: Record<string, unknown>
}

export interface PlotRecommendationResponse {
  recommended_chart: string
  confidence: number
  reasoning: string
  alternative_charts: string[]
  suggested_parameters: Record<string, unknown>
  recommendations?: PlotRecommendationItem[]
  data_analysis?: Record<string, unknown>
}

export interface PlotChartTypeInfo {
  chart_type: string
  name: string
  description: string
  required_columns: Record<string, unknown>
}

export interface PlotChartTypesResponse {
  chart_types: PlotChartTypeInfo[]
  count: number
}

export interface PlotGenerateResponse {
  success: boolean
  chart_type: string
  image?: string
  file_path?: string
  message: string
  recommendation?: PlotRecommendationResponse
}

export interface RealtimePlotSessionStatus {
  session_id: string
  chart_type: string
  point_count: number
  x_col?: string | null
  y_col?: string | null
  created_at: string
  last_updated: string
}

export interface RealtimePlotSessionResponse {
  success: boolean
  session_id: string
  status: RealtimePlotSessionStatus
}

export interface RealtimePlotUpdateResponse {
  success: boolean
  image?: string
  points_added?: number
  status: RealtimePlotSessionStatus
}

interface PlotAgentLaunchInfo {
  pythonCommand: string
  pythonArgs: string[]
  agentRoot: string
  bridgePath: string
}

interface PlotBundledLayout {
  resourceRoot: string
  agentRoot: string
  runtimeRoot: string | null
}

interface PlotBridgeEnvelope<T> {
  ok: boolean
  result?: T
  error?: string
  traceback?: string
}

interface RealtimeSessionRecord {
  sessionId: string
  chartType: string
  style: 'publication' | 'default' | 'colorful'
  title?: string
  xlabel?: string
  ylabel?: string
  points: Array<Record<string, unknown>>
  createdAt: string
  lastUpdated: string
  xCol?: string | null
  yCol?: string | null
}

const LOCAL_BASE_URL = 'local://plot-agent'

function uniqueNormalizedPaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => path.normalize(String(value || '').trim())).filter(Boolean)))
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function getPortableExecutableDirs(): string[] {
  const envDir = String(process.env.PORTABLE_EXECUTABLE_DIR || '').trim()
  const envFile = String(process.env.PORTABLE_EXECUTABLE_FILE || '').trim()
  return uniqueNormalizedPaths([
    envDir,
    envFile ? path.dirname(envFile) : '',
  ])
}

function getCommonSearchRoots(appPath: string, execDir: string): string[] {
  const portableDirs = getPortableExecutableDirs()
  const tempDir = app.getPath('temp')
  const userDataDir = app.getPath('userData')
  const resourcesParent = path.dirname(process.resourcesPath)

  return uniqueNormalizedPaths([
    ...portableDirs,
    ...portableDirs.map((dirPath) => path.join(dirPath, 'resources')),
    ...portableDirs.map((dirPath) => path.join(dirPath, 'app')),
    process.resourcesPath,
    resourcesParent,
    path.resolve(resourcesParent, '..'),
    execDir,
    path.resolve(execDir, '..'),
    path.resolve(execDir, '..', '..'),
    appPath,
    path.dirname(appPath),
    path.resolve(appPath, '..'),
    path.resolve(appPath, '..', '..'),
    tempDir,
    path.join(tempDir, 'AI-Office 3.0'),
    path.join(tempDir, 'ai-office-3'),
    userDataDir,
    process.cwd(),
  ])
}

function getFixedResourceRoots(appPath: string, execDir: string): string[] {
  const portableDirs = getPortableExecutableDirs()
  const appDir = path.dirname(appPath)
  const appLooksLikeAsar = /app\.asar$/i.test(appPath)

  return uniqueNormalizedPaths([
    ...portableDirs.map((dirPath) => path.join(dirPath, 'resources')),
    process.resourcesPath,
    path.join(execDir, 'resources'),
    appLooksLikeAsar ? appDir : '',
    appLooksLikeAsar ? path.join(appDir, 'resources') : '',
  ])
}

function getExactBundledDirCandidates(dirName: string, appPath: string, execDir: string): string[] {
  return uniqueNormalizedPaths(getFixedResourceRoots(appPath, execDir).map((rootPath) => path.join(rootPath, dirName)))
}

async function findPathBySuffix(searchRoots: string[], suffixParts: string[], maxDepth = 2): Promise<string | null> {
  const queue = uniqueNormalizedPaths(searchRoots).map((dirPath) => ({ dirPath, depth: 0 }))
  const seen = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    const normalized = path.normalize(current.dirPath)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)

    const candidate = path.join(current.dirPath, ...suffixParts)
    if (await pathExists(candidate)) {
      return candidate
    }

    if (current.depth >= maxDepth) {
      continue
    }

    try {
      const entries = await fs.readdir(current.dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        if (entry.name === '.' || entry.name === '..' || entry.name === 'node_modules' || entry.name === '.git') {
          continue
        }
        queue.push({ dirPath: path.join(current.dirPath, entry.name), depth: current.depth + 1 })
      }
    } catch {
      continue
    }
  }

  return null
}

async function resolveCommandExitCode(command: string, args: string[], cwd?: string): Promise<number | null> {
  try {
    const child = spawn(command, args, { stdio: 'ignore', cwd })
    return await new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(null))
      child.once('exit', (code) => resolve(code))
    })
  } catch {
    return null
  }
}

async function probePlotBridge<T>(
  command: string,
  args: string[],
  bridgePath: string,
  agentRoot: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(command, [...args, '-u', bridgePath], {
        cwd: agentRoot,
        env: {
          ...process.env,
          PYTHONPATH: agentRoot,
          MPLBACKEND: process.env.MPLBACKEND || 'Agg',
          PYTHONIOENCODING: 'utf-8',
        },
        stdio: 'pipe',
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.once('error', (error) => {
        resolve({ ok: false, error: error.message })
      })

      child.once('exit', (code) => {
        const parsed = parseJsonOutput<T>(stdout)
        if (code === 0 && parsed.ok) {
          resolve({ ok: true })
          return
        }

        resolve({
          ok: false,
          error: parsed.error || parsed.traceback || stderr.trim() || stdout.trim() || `Plot bridge exited with code ${String(code)}`,
        })
      })

      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseJsonOutput<T>(output: string): PlotBridgeEnvelope<T> {
  const raw = String(output || '').trim()
  if (!raw) {
    return { ok: false, error: 'Plot bridge returned empty output' }
  }

  try {
    return JSON.parse(raw) as PlotBridgeEnvelope<T>
  } catch {
    const match = raw.match(/\{[\s\S]*\}$/)
    if (!match) {
      return { ok: false, error: raw }
    }
    try {
      return JSON.parse(match[0]) as PlotBridgeEnvelope<T>
    } catch {
      return { ok: false, error: raw }
    }
  }
}

export class PlotAgentService {
  private launchInfo: PlotAgentLaunchInfo | null = null
  private bundledLayout: PlotBundledLayout | null = null
  private lastError: string | null = null
  private readonly realtimeSessions = new Map<string, RealtimeSessionRecord>()

  get baseUrl(): string {
    return LOCAL_BASE_URL
  }

  private async resolveBundledLayout(): Promise<PlotBundledLayout | null> {
    if (this.bundledLayout) {
      return this.bundledLayout
    }

    const appPath = app.getAppPath()
    const execDir = path.dirname(process.execPath)
    const resourceRoots = getFixedResourceRoots(appPath, execDir)

    for (const resourceRoot of resourceRoots) {
      const agentRoot = path.join(resourceRoot, 'merged-plot-agent')
      const bridgePath = path.join(agentRoot, 'local_bridge.py')
      if (!await pathExists(bridgePath)) {
        continue
      }

      const runtimeRoot = path.join(resourceRoot, 'plot-agent-runtime')
      this.bundledLayout = {
        resourceRoot,
        agentRoot,
        runtimeRoot: await pathExists(runtimeRoot) ? runtimeRoot : null,
      }
      this.lastError = null
      return this.bundledLayout
    }

    return null
  }

  private async resolveAgentRoot(): Promise<string | null> {
    const appPath = app.getAppPath()
    const execDir = path.dirname(process.execPath)
    const portableDirs = getPortableExecutableDirs()
    const commonSearchRoots = getCommonSearchRoots(appPath, execDir)
    const bundledLayout = await this.resolveBundledLayout()
    if (bundledLayout?.agentRoot) {
      return bundledLayout.agentRoot
    }

    const candidates = uniqueNormalizedPaths([
      ...getExactBundledDirCandidates('merged-plot-agent', appPath, execDir),
      ...portableDirs.map((dirPath) => path.join(dirPath, 'resources', 'merged-plot-agent')),
      ...portableDirs.map((dirPath) => path.join(dirPath, 'merged-plot-agent')),
      path.join(process.resourcesPath, 'merged-plot-agent'),
      path.join(execDir, 'resources', 'merged-plot-agent'),
      path.join(execDir, 'merged-plot-agent'),
      path.resolve(process.resourcesPath, '..', 'merged-plot-agent'),
      path.join(appPath, 'merged-plot-agent'),
      path.resolve(appPath, '..', 'merged-plot-agent'),
      path.resolve(appPath, '..', '..', 'merged-plot-agent'),
      path.resolve(execDir, '..', 'merged-plot-agent'),
      path.resolve(process.cwd(), '..', 'merged-plot-agent'),
      path.resolve(process.cwd(), 'merged-plot-agent'),
      '/data/AI_writer/merged-plot-agent',
      ...commonSearchRoots.map((rootPath) => path.join(rootPath, 'merged-plot-agent')),
    ])

    for (const candidate of candidates) {
      if (await pathExists(path.join(candidate, 'local_bridge.py'))) {
        this.lastError = null
        return candidate
      }
    }

    const discoveredBridge = await findPathBySuffix(commonSearchRoots, ['local_bridge.py'], 4)

    if (discoveredBridge) {
      const discoveredRoot = path.dirname(discoveredBridge)
      const resourceRoot = path.dirname(discoveredRoot)
      this.bundledLayout = {
        resourceRoot,
        agentRoot: discoveredRoot,
        runtimeRoot: await pathExists(path.join(resourceRoot, 'plot-agent-runtime')) ? path.join(resourceRoot, 'plot-agent-runtime') : null,
      }
      this.lastError = null
      return discoveredRoot
    }

    this.lastError = [
      '未找到 merged-plot-agent/local_bridge.py',
      `fixedRoots=${getFixedResourceRoots(appPath, execDir).join(' | ') || '(none)'}`,
      `resourcesPath=${process.resourcesPath}`,
      `appPath=${appPath}`,
      `execPath=${process.execPath}`,
      `cwd=${process.cwd()}`,
      `tempDir=${app.getPath('temp')}`,
      `userData=${app.getPath('userData')}`,
      `portableDir=${portableDirs.join(' | ') || '(none)'}`,
      `checked=${candidates.join(' | ')}`,
    ].join(' ; ')
    return null
  }

  private async canRunPlotAgent(
    command: string,
    args: string[],
    agentRoot: string,
    bridgePath: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const bridgeProbe = await probePlotBridge<PlotChartTypesResponse>(
      command,
      args,
      bridgePath,
      agentRoot,
      { operation: 'types' },
    )
    if (bridgeProbe.ok) {
      return bridgeProbe
    }

    const exitCode = await resolveCommandExitCode(
      command,
      [...args, '-c', 'import pandas,matplotlib,seaborn,numpy,requests,yaml,PIL'],
      agentRoot,
    )
    if (exitCode === 0) {
      return { ok: true }
    }

    return bridgeProbe
  }

  private async detectPythonCommand(agentRoot: string): Promise<{ command: string; args: string[] } | null> {
    const execDir = path.dirname(process.execPath)
    const portableDirs = getPortableExecutableDirs()
    const appPath = app.getAppPath()
    const bridgePath = path.join(agentRoot, 'local_bridge.py')
    const commonSearchRoots = getCommonSearchRoots(appPath, execDir)
    const bundledLayout = await this.resolveBundledLayout()
    const candidateFailures: string[] = []
    const exactRuntimeCandidates = process.platform === 'win32'
      ? uniqueNormalizedPaths([
          bundledLayout?.runtimeRoot ? path.join(bundledLayout.runtimeRoot, 'python.exe') : '',
          bundledLayout?.runtimeRoot ? path.join(bundledLayout.runtimeRoot, 'Scripts', 'python.exe') : '',
          ...getExactBundledDirCandidates('plot-agent-runtime', appPath, execDir).map((runtimeRoot) => path.join(runtimeRoot, 'python.exe')),
          ...getExactBundledDirCandidates('plot-agent-runtime', appPath, execDir).map((runtimeRoot) => path.join(runtimeRoot, 'Scripts', 'python.exe')),
        ])
      : uniqueNormalizedPaths([
          bundledLayout?.runtimeRoot ? path.join(bundledLayout.runtimeRoot, 'bin', 'python3') : '',
          bundledLayout?.runtimeRoot ? path.join(bundledLayout.runtimeRoot, 'bin', 'python') : '',
          ...getExactBundledDirCandidates('plot-agent-runtime', appPath, execDir).map((runtimeRoot) => path.join(runtimeRoot, 'bin', 'python3')),
          ...getExactBundledDirCandidates('plot-agent-runtime', appPath, execDir).map((runtimeRoot) => path.join(runtimeRoot, 'bin', 'python')),
        ])

    for (const candidate of exactRuntimeCandidates) {
      if (!await pathExists(candidate)) {
        continue
      }

      const probe = await this.canRunPlotAgent(candidate, [], agentRoot, bridgePath)
      if (probe.ok) {
        return { command: candidate, args: [] }
      }

      candidateFailures.push(`${candidate} => ${probe.error || 'probe failed'}`)
    }

    const resourceCandidates = process.platform === 'win32'
      ? [
          ...portableDirs.map((dirPath) => path.join(dirPath, 'resources', 'plot-agent-runtime', 'python.exe')),
          ...portableDirs.map((dirPath) => path.join(dirPath, 'resources', 'plot-agent-runtime', 'Scripts', 'python.exe')),
          ...portableDirs.map((dirPath) => path.join(dirPath, 'plot-agent-runtime', 'python.exe')),
          ...portableDirs.map((dirPath) => path.join(dirPath, 'plot-agent-runtime', 'Scripts', 'python.exe')),
          path.join(process.resourcesPath, 'plot-agent-runtime', 'python.exe'),
          path.join(process.resourcesPath, 'plot-agent-runtime', 'Scripts', 'python.exe'),
          path.join(execDir, 'resources', 'plot-agent-runtime', 'python.exe'),
          path.join(execDir, 'resources', 'plot-agent-runtime', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(process.resourcesPath, 'plot-agent-runtime', 'bin', 'python3'),
          path.join(process.resourcesPath, 'plot-agent-runtime', 'bin', 'python'),
          path.join(execDir, 'resources', 'plot-agent-runtime', 'bin', 'python3'),
          path.join(execDir, 'resources', 'plot-agent-runtime', 'bin', 'python'),
        ]

    const discoveredRuntime = await findPathBySuffix([
      ...commonSearchRoots,
      path.dirname(agentRoot),
      path.resolve(agentRoot, '..'),
    ], process.platform === 'win32' ? ['plot-agent-runtime', 'python.exe'] : ['plot-agent-runtime', 'bin', 'python3'], 4)

    const runtimeCandidates = uniqueNormalizedPaths([
      ...(discoveredRuntime ? [discoveredRuntime] : []),
      ...resourceCandidates,
    ])

    for (const candidate of runtimeCandidates) {
      if (!await pathExists(candidate)) {
        continue
      }

      const probe = await this.canRunPlotAgent(candidate, [], agentRoot, bridgePath)
      if (probe.ok) {
        return { command: candidate, args: [] }
      }

      candidateFailures.push(`${candidate} => ${probe.error || 'probe failed'}`)
    }

    const envCandidate = String(process.env.AI_WRITER_PLOT_AGENT_PYTHON || '').trim()
    if (envCandidate) {
      const probe = await this.canRunPlotAgent(envCandidate, [], agentRoot, bridgePath)
      if (probe.ok) {
        return { command: envCandidate, args: [] }
      }

      candidateFailures.push(`${envCandidate} => ${probe.error || 'probe failed'}`)
    }

    const bundledVenvCandidates = process.platform === 'win32'
      ? [path.join(agentRoot, '.venv', 'Scripts', 'python.exe')]
      : [path.join(agentRoot, '.venv', 'bin', 'python3'), path.join(agentRoot, '.venv', 'bin', 'python')]

    for (const candidate of bundledVenvCandidates) {
      if (!await pathExists(candidate)) {
        continue
      }

      const probe = await this.canRunPlotAgent(candidate, [], agentRoot, bridgePath)
      if (probe.ok) {
        return { command: candidate, args: [] }
      }

      candidateFailures.push(`${candidate} => ${probe.error || 'probe failed'}`)
    }

    const workspaceVenvCandidates = process.platform === 'win32'
      ? [path.resolve(agentRoot, '..', '.venv', 'Scripts', 'python.exe')]
      : [path.resolve(agentRoot, '..', '.venv', 'bin', 'python3'), path.resolve(agentRoot, '..', '.venv', 'bin', 'python')]

    for (const candidate of workspaceVenvCandidates) {
      if (!await pathExists(candidate)) {
        continue
      }

      const probe = await this.canRunPlotAgent(candidate, [], agentRoot, bridgePath)
      if (probe.ok) {
        return { command: candidate, args: [] }
      }

      candidateFailures.push(`${candidate} => ${probe.error || 'probe failed'}`)
    }

    const condaCommand = String(process.env.CONDA_EXE || '').trim() || 'conda'
    const condaCandidates = [
      { command: condaCommand, args: ['run', '-n', 'plot-agent', 'python'] },
      { command: condaCommand, args: ['run', '-n', 'base', 'python'] },
    ]

    for (const candidate of condaCandidates) {
      const probe = await this.canRunPlotAgent(candidate.command, candidate.args, agentRoot, bridgePath)
      if (probe.ok) {
        return candidate
      }

      candidateFailures.push(`${[candidate.command, ...candidate.args].join(' ')} => ${probe.error || 'probe failed'}`)
    }

    const shellCandidates = process.platform === 'win32'
      ? ['python.exe', 'python']
      : ['python3', 'python']

    for (const candidate of shellCandidates) {
      const probe = await this.canRunPlotAgent(candidate, [], agentRoot, bridgePath)
      if (probe.ok) {
        return { command: candidate, args: [] }
      }

      candidateFailures.push(`${candidate} => ${probe.error || 'probe failed'}`)
    }

    this.lastError = [
      '未找到可用的 Plot Agent Python 环境',
      `agentRoot=${agentRoot}`,
      `fixedRoots=${getFixedResourceRoots(appPath, execDir).join(' | ') || '(none)'}`,
      `exactRuntimeCandidates=${exactRuntimeCandidates.join(' | ') || '(none)'}`,
      `resourcesPath=${process.resourcesPath}`,
      `execPath=${process.execPath}`,
      `portableDir=${portableDirs.join(' | ') || '(none)'}`,
      `runtimeCandidates=${runtimeCandidates.join(' | ') || '(none)'}`,
      `commonRoots=${commonSearchRoots.join(' | ') || '(none)'}`,
      `probeFailures=${candidateFailures.join(' | ') || '(none)'}`,
    ].join(' ; ')

    return null
  }

  private async resolveLaunchInfo(): Promise<PlotAgentLaunchInfo> {
    if (this.launchInfo) {
      return this.launchInfo
    }

    const agentRoot = await this.resolveAgentRoot()
    if (!agentRoot) {
      throw new Error(this.lastError || '未找到 merged-plot-agent 目录或 local_bridge.py')
    }

    const bridgePath = path.join(agentRoot, 'local_bridge.py')
    if (!await pathExists(bridgePath)) {
      throw new Error('未找到 Plot Agent 本地桥接脚本 local_bridge.py')
    }

    const python = await this.detectPythonCommand(agentRoot)
    if (!python) {
      throw new Error(this.lastError || '未找到可用的 Plot Agent Python 环境，缺少 pandas/matplotlib 等依赖')
    }

    this.launchInfo = {
      pythonCommand: python.command,
      pythonArgs: python.args,
      agentRoot,
      bridgePath,
    }
    return this.launchInfo
  }

  private async runBridge<T>(payload: Record<string, unknown>): Promise<T> {
    const launchInfo = await this.resolveLaunchInfo()

    return await new Promise<T>((resolve, reject) => {
      const child = spawn(
        launchInfo.pythonCommand,
        [...launchInfo.pythonArgs, '-u', launchInfo.bridgePath],
        {
          cwd: launchInfo.agentRoot,
          env: {
            ...process.env,
            PYTHONPATH: launchInfo.agentRoot,
            MPLBACKEND: process.env.MPLBACKEND || 'Agg',
            PYTHONIOENCODING: 'utf-8',
          },
          stdio: 'pipe',
        },
      )

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.once('error', (error) => {
        this.lastError = error.message
        reject(error)
      })
      child.once('exit', (code) => {
        const parsed = parseJsonOutput<T>(stdout)
        if (code === 0 && parsed.ok && parsed.result !== undefined) {
          this.lastError = null
          resolve(parsed.result)
          return
        }

        const message = parsed.error || stderr.trim() || stdout.trim() || `Plot bridge exited with code ${String(code)}`
        this.lastError = message
        reject(new Error(message))
      })

      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    })
  }

  async getStatus(): Promise<PlotAgentStatus> {
    try {
      const launchInfo = await this.resolveLaunchInfo()
      return {
        ready: true,
        running: false,
        baseUrl: this.baseUrl,
        port: 0,
        pythonCommand: launchInfo.pythonCommand,
        agentRoot: launchInfo.agentRoot,
        lastError: this.lastError,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastError = message
      return {
        ready: false,
        running: false,
        baseUrl: this.baseUrl,
        port: 0,
        pythonCommand: this.launchInfo?.pythonCommand || null,
        agentRoot: this.launchInfo?.agentRoot || null,
        lastError: message,
      }
    }
  }

  async stop(): Promise<void> {
    this.realtimeSessions.clear()
  }

  async getChartTypes(): Promise<PlotChartTypesResponse> {
    return this.runBridge<PlotChartTypesResponse>({ operation: 'types' })
  }

  async recommendFromFile(filePath: string, useLlm = false): Promise<PlotRecommendationResponse> {
    return this.runBridge<PlotRecommendationResponse>({
      operation: 'recommend',
      file_path: filePath,
      use_llm: useLlm,
    })
  }

  async generateFromFile(params: {
    filePath: string
    chartType?: string
    outputFormat?: 'base64' | 'file'
    style?: 'publication' | 'default' | 'colorful'
    title?: string
    xlabel?: string
    ylabel?: string
    x?: string
    y?: string
    hue?: string
    autoRecommend?: boolean
    mode?: 'smart' | 'manual'
  }): Promise<PlotGenerateResponse> {
    return this.runBridge<PlotGenerateResponse>({
      operation: 'generate',
      file_path: params.filePath,
      chart_type: params.chartType,
      output_format: params.outputFormat || 'base64',
      style: params.style || 'publication',
      title: params.title,
      xlabel: params.xlabel,
      ylabel: params.ylabel,
      x: params.x,
      y: params.y,
      hue: params.hue,
      auto_recommend: params.autoRecommend ?? !params.chartType,
      mode: params.mode || 'smart',
    })
  }

  private toRealtimeStatus(record: RealtimeSessionRecord): RealtimePlotSessionStatus {
    return {
      session_id: record.sessionId,
      chart_type: record.chartType,
      point_count: record.points.length,
      x_col: record.xCol ?? null,
      y_col: record.yCol ?? null,
      created_at: record.createdAt,
      last_updated: record.lastUpdated,
    }
  }

  async createRealtimeSession(params: {
    chartType: string
    style?: 'publication' | 'default' | 'colorful'
    title?: string
    xlabel?: string
    ylabel?: string
  }): Promise<RealtimePlotSessionResponse> {
    const sessionId = randomUUID()
    const now = new Date().toISOString()
    const record: RealtimeSessionRecord = {
      sessionId,
      chartType: params.chartType,
      style: params.style || 'publication',
      title: params.title,
      xlabel: params.xlabel,
      ylabel: params.ylabel,
      points: [],
      createdAt: now,
      lastUpdated: now,
      xCol: null,
      yCol: null,
    }
    this.realtimeSessions.set(sessionId, record)
    return {
      success: true,
      session_id: sessionId,
      status: this.toRealtimeStatus(record),
    }
  }

  private getRealtimeRecord(sessionId: string): RealtimeSessionRecord {
    const record = this.realtimeSessions.get(sessionId)
    if (!record) {
      throw new Error('Session not found')
    }
    return record
  }

  private async renderRealtimeSession(record: RealtimeSessionRecord, pointsAdded?: number): Promise<RealtimePlotUpdateResponse> {
    const rendered = await this.runBridge<{
      success: boolean
      image?: string
      status?: {
        x_col?: string | null
        y_col?: string | null
        point_count?: number
      }
    }>({
      operation: 'realtime_render',
      chart_type: record.chartType,
      style: record.style,
      title: record.title,
      xlabel: record.xlabel,
      ylabel: record.ylabel,
      points: record.points,
    })

    record.lastUpdated = new Date().toISOString()
    record.xCol = rendered.status?.x_col ?? record.xCol ?? null
    record.yCol = rendered.status?.y_col ?? record.yCol ?? null

    return {
      success: Boolean(rendered.success),
      image: rendered.image,
      points_added: pointsAdded,
      status: this.toRealtimeStatus(record),
    }
  }

  async addRealtimePoint(sessionId: string, point: Record<string, unknown>): Promise<RealtimePlotUpdateResponse> {
    const record = this.getRealtimeRecord(sessionId)
    record.points.push(point)
    return this.renderRealtimeSession(record, 1)
  }

  async addRealtimePoints(sessionId: string, points: Array<Record<string, unknown>>): Promise<RealtimePlotUpdateResponse> {
    const record = this.getRealtimeRecord(sessionId)
    const validPoints = points.filter((point) => point && typeof point === 'object')
    if (validPoints.length === 0) {
      throw new Error('No valid points added')
    }
    record.points.push(...validPoints)
    return this.renderRealtimeSession(record, validPoints.length)
  }

  async getRealtimePlot(sessionId: string): Promise<RealtimePlotUpdateResponse> {
    const record = this.getRealtimeRecord(sessionId)
    if (record.points.length === 0) {
      throw new Error('No data points in session')
    }
    return this.renderRealtimeSession(record)
  }

  async getRealtimeSessionStatus(sessionId: string): Promise<{ success: boolean; status: RealtimePlotSessionStatus }> {
    const record = this.getRealtimeRecord(sessionId)
    return {
      success: true,
      status: this.toRealtimeStatus(record),
    }
  }

  async deleteRealtimeSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    if (!this.realtimeSessions.has(sessionId)) {
      throw new Error('Session not found')
    }
    this.realtimeSessions.delete(sessionId)
    return { success: true, message: 'Session deleted' }
  }
}