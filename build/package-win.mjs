import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const verifyOnly = args.includes('--verify-only')
const archiveLegacyOnly = args.includes('--archive-legacy-only')
const includePlotRuntime = args.includes('--with-plot-runtime')

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const introductionRemakeRoot = path.resolve(projectRoot, '..', 'introduction-remake-app')
const runtimeRoot = path.join(projectRoot, 'build', 'plot-agent-runtime')
const voskModelArchivePath = path.join(projectRoot, 'build', 'vosk-models', 'vosk-model-small-cn-0.3.tar.gz')
const builderConfigPath = path.join(projectRoot, 'electron-builder.json')
const releaseOutputRoot = path.join(projectRoot, 'release')
const packagedResourcesRoot = path.join(releaseOutputRoot, 'win-unpacked', 'resources')
const legacyArchiveRoot = path.join(releaseOutputRoot, 'legacy-ai-writer')
const requiredKnowledgeSeedFiles = [
  '拜访函_模板1.docx',
  '散文模板.docx',
  '贺信_模板.docx',
  '校务拜访函_来校交流模板.docx',
  '校务贺信_合作成果祝贺模板.docx',
  '校务贺信_校庆祝贺模板.docx',
  '校务邀请函_论坛活动模板.docx',
  '校务通知_专项工作会议模板.docx',
  '校园实景参考_中庭与楼体.jpg',
  '校园实景参考_学生中心外立面.jpg',
  '校园实景参考_教学楼晨景.jpg',
  '校园实景参考_水景楼体.jpg',
  '校园风格参考拼贴.png',
  '校园楼体插画参考.png',
  '港中文深圳校门手绘参考.png',
]
const requiredEssayStylePresetDirs = [
  'Andhika_Ramadhian',
  'Cuno_Amiet',
  'Erin_Hanson',
  'Felix_Vallotton',
  'Joan_Miro',
  'Kawase_Hasui',
  'Reiji_Hiramatsu',
  'Sergiu_Ciochina',
]
const presetImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

const LEGACY_RELEASE_PREFIXES = ['AI-Writer']
const CURRENT_RELEASE_PREFIXES = ['AI-Office']
const STALE_PORTABLE_ARTIFACT_PATTERN = /^AI-Office-.*-Portable\.exe$/i

function log(message) {
  process.stdout.write(`[package-win] ${message}\n`)
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function assertDirectory(targetPath, label) {
  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    throw new Error(`${label} 不存在: ${targetPath}`)
  }
}

async function assertDirectoryContainsImages(targetPath, label) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch(() => [])
  const hasImage = entries.some((entry) => entry.isFile() && presetImageExtensions.has(path.extname(entry.name).toLowerCase()))
  if (!hasImage) {
    throw new Error(`${label} 缺少图片资源: ${targetPath}`)
  }
}

async function assertFile(targetPath, label) {
  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat || !stat.isFile()) {
    throw new Error(`${label} 不存在: ${targetPath}`)
  }
}

async function verifyPreparedRuntime(baseDir) {
  await assertDirectory(baseDir, 'plot-agent-runtime 目录')
  await assertFile(path.join(baseDir, 'python.exe'), '内置 python.exe')
  await assertFile(path.join(baseDir, 'RUNTIME_READY.txt'), 'RUNTIME_READY.txt')
  await assertDirectory(path.join(baseDir, 'Lib', 'site-packages'), 'Lib/site-packages')
}

async function verifyPackagedResources(baseDir) {
  await assertDirectory(baseDir, 'win-unpacked resources 目录')
  await assertFile(path.join(baseDir, 'vosk-models', 'vosk-model-small-cn-0.3.tar.gz'), 'Vosk 中文模型归档')
  if (includePlotRuntime) {
    await verifyPreparedRuntime(path.join(baseDir, 'plot-agent-runtime'))
  }
  // merged-plot-agent 源目录可能不存在（electron-builder 已跳过复制），仅在打包进去时校验
  const mergedPlotAgentSource = path.resolve(projectRoot, '..', 'merged-plot-agent')
  if (await pathExists(mergedPlotAgentSource)) {
    await assertDirectory(path.join(baseDir, 'merged-plot-agent'), 'merged-plot-agent 目录')
    await assertFile(path.join(baseDir, 'merged-plot-agent', 'local_bridge.py'), 'local_bridge.py')
  } else {
    log('merged-plot-agent 源目录不存在，已跳过相关校验（绘图功能不可用）')
  }
  await assertFile(path.join(baseDir, 'introduction-remake-app', 'dist', 'index.html'), 'Introduction Remake bundled renderer')
  await assertFile(path.join(baseDir, 'data', 'tier1_journals.json'), 'Introduction Remake tier1_journals.json')
  await assertDirectory(path.join(baseDir, 'data', 'knowledge-seeds'), 'knowledge-seeds 目录')
  for (const fileName of requiredKnowledgeSeedFiles) {
    await assertFile(path.join(baseDir, 'data', 'knowledge-seeds', fileName), `知识库种子 ${fileName}`)
  }
  const essayStylePresetRoot = path.join(baseDir, 'data', 'essay-style-presets')
  await assertDirectory(essayStylePresetRoot, 'essay-style-presets 目录')
  for (const dirName of requiredEssayStylePresetDirs) {
    const presetDir = path.join(essayStylePresetRoot, dirName)
    await assertDirectory(presetDir, `散文风格 preset ${dirName}`)
    await assertDirectoryContainsImages(presetDir, `散文风格 preset ${dirName}`)
  }
}

async function createBuilderConfig() {
  const raw = await fs.readFile(builderConfigPath, 'utf8')
  const config = JSON.parse(raw)

  if (includePlotRuntime) {
    config.extraResources = [
      ...(Array.isArray(config.extraResources) ? config.extraResources : []),
      {
        from: 'build/plot-agent-runtime',
        to: 'plot-agent-runtime',
        filter: ['**/*'],
      },
    ]
  }

  const tempConfigPath = path.join(projectRoot, 'build', includePlotRuntime ? 'electron-builder.with-plot-runtime.tmp.json' : 'electron-builder.slim.tmp.json')
  await fs.writeFile(tempConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return tempConfigPath
}

function isLegacyReleaseArtifact(entryName) {
  return LEGACY_RELEASE_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

function formatArchiveTimestamp(date = new Date()) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

async function resolveArchivePath(entryName) {
  const targetPath = path.join(legacyArchiveRoot, entryName)
  if (!(await pathExists(targetPath))) {
    return targetPath
  }

  const parsed = path.parse(entryName)
  return path.join(legacyArchiveRoot, `${parsed.name}.archived-${formatArchiveTimestamp()}${parsed.ext}`)
}

async function writeLegacyArchiveReadme() {
  const readmePath = path.join(legacyArchiveRoot, 'README.txt')
  const content = [
    'AI Writer 3.0 release archive',
    '',
    'Rules:',
    '- release/ 根目录只保留当前 AI-Office 3.0 产物。',
    '- 所有以 AI-Writer 开头的历史产物都会归档到当前目录。',
    '- 当前 Windows 打包脚本默认只产出 zip，不再产出 portable 或 Setup 安装包。',
    '- 可直接对外分发的当前产物是 release/ 根目录下以 AI-Office 开头的文件。',
    '',
    `Current root prefixes: ${CURRENT_RELEASE_PREFIXES.join(', ')}`,
    `Archived legacy prefixes: ${LEGACY_RELEASE_PREFIXES.join(', ')}`,
  ].join('\n')

  await fs.writeFile(readmePath, content, 'utf8')
}

async function archiveLegacyReleaseArtifacts() {
  const releaseDirExists = await pathExists(releaseOutputRoot)
  if (!releaseDirExists) {
    return []
  }

  const entries = await fs.readdir(releaseOutputRoot, { withFileTypes: true })
  const legacyEntries = entries.filter((entry) => entry.isFile() && isLegacyReleaseArtifact(entry.name))

  if (legacyEntries.length === 0) {
    if (await pathExists(legacyArchiveRoot)) {
      await writeLegacyArchiveReadme()
    }
    log('release 根目录未发现需要归档的 AI-Writer 历史产物')
    return []
  }

  await fs.mkdir(legacyArchiveRoot, { recursive: true })

  const movedEntries = []
  for (const entry of legacyEntries) {
    const fromPath = path.join(releaseOutputRoot, entry.name)
    const toPath = await resolveArchivePath(entry.name)
    await fs.rename(fromPath, toPath)
    movedEntries.push({ from: entry.name, to: path.basename(toPath) })
  }

  await writeLegacyArchiveReadme()
  log(`已归档 ${movedEntries.length} 个 AI-Writer 历史产物到 ${path.relative(projectRoot, legacyArchiveRoot)}`)
  for (const movedEntry of movedEntries) {
    log(`归档: ${movedEntry.from} -> legacy-ai-writer/${movedEntry.to}`)
  }

  return movedEntries
}

async function removeStalePortableArtifacts() {
  if (!(await pathExists(releaseOutputRoot))) {
    return []
  }

  const entries = await fs.readdir(releaseOutputRoot, { withFileTypes: true })
  const stalePortableEntries = entries.filter((entry) => entry.isFile() && STALE_PORTABLE_ARTIFACT_PATTERN.test(entry.name))

  if (stalePortableEntries.length === 0) {
    return []
  }

  for (const entry of stalePortableEntries) {
    await fs.rm(path.join(releaseOutputRoot, entry.name), { force: true })
  }

  log(`已清理 ${stalePortableEntries.length} 个旧 portable 产物`) 
  for (const entry of stalePortableEntries) {
    log(`移除: ${entry.name}`)
  }

  return stalePortableEntries.map((entry) => entry.name)
}

async function buildIntroductionRemakeRenderer() {
  log('开始构建 Introduction Remake renderer 资源')
  await runCommand('npm', ['run', 'build'], { cwd: introductionRemakeRoot })
  await assertFile(path.join(introductionRemakeRoot, 'dist', 'index.html'), 'Introduction Remake dist/index.html')
  log('Introduction Remake renderer 资源已就绪')
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' && command === 'npm'
      ? 'npm.cmd'
      : command
    const useShell = process.platform === 'win32' && executable.toLowerCase().endsWith('.cmd')
    const child = spawn(executable, commandArgs, {
      cwd: options.cwd || projectRoot,
      stdio: 'inherit',
      shell: useShell,
      env: {
        ...process.env,
        ...options.env,
      },
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${executable} 退出码 ${String(code)}`))
    })
  })
}

async function runElectronBuilder(targets) {
  const configPath = await createBuilderConfig()
  try {
    await runCommand(path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'), [
      '--win',
      ...targets,
      '--config',
      configPath,
    ], {
      env: {
        // 禁止自动搜索本机证书，不触发任何签名逻辑
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      },
    })
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => undefined)
  }
}

async function ensurePreparedRuntime() {
  const runtimeReady = await pathExists(path.join(runtimeRoot, 'RUNTIME_READY.txt'))
  const pythonReady = await pathExists(path.join(runtimeRoot, 'python.exe'))
  const packagesReady = await pathExists(path.join(runtimeRoot, 'Lib', 'site-packages'))

  if (runtimeReady && pythonReady && packagesReady) {
    await verifyPreparedRuntime(runtimeRoot)
    log('检测到已准备好的 Windows Python runtime')
    return
  }

  if (process.platform !== 'win32') {
    log('当前主机不是 Windows，尝试使用跨平台脚本准备 Windows Python runtime')
    await runCommand('python3', [path.join(projectRoot, 'build', 'prepare-plot-runtime.py')])
    await verifyPreparedRuntime(runtimeRoot)
    log('跨平台 Windows Python runtime 准备完成')
    return
  }

  log('未检测到完整的 Windows Python runtime，开始自动准备')
  await runCommand('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'build', 'prepare-plot-runtime-win.ps1')])
  await verifyPreparedRuntime(runtimeRoot)
  log('Windows Python runtime 准备完成')
}

async function ensurePreparedVoskModel() {
  log('开始准备 Vosk 中文模型资源')
  await runCommand(process.execPath, [path.join(projectRoot, 'build', 'prepare-vosk-model.mjs')])
  await assertFile(voskModelArchivePath, 'Vosk 中文模型归档')
  log('Vosk 中文模型资源已就绪')
}

/**
 * electron-builder v24 在 Windows 上无条件使用 winCodeSign 包内的 rcedit-x64.exe
 * 来写入 exe 图标和版本信息，同时包含 macOS 符号链接导致普通用户无法提取完整包。
 * 解决方案：只下载 rcedit-x64.exe 单文件放入缓存目录，其余文件均不需要（仅 zip 无签名）。
 */
async function ensureWinCodeSignCache() {
  if (process.platform !== 'win32') return

  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return

  const cacheDest = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0')
  const rceditPath = path.join(cacheDest, 'rcedit-x64.exe')

  if (await pathExists(rceditPath)) {
    log('winCodeSign rcedit-x64.exe 已就绪，跳过下载')
    return
  }

  await fs.mkdir(cacheDest, { recursive: true })

  log('正在下载 rcedit-x64.exe（electron-builder 写入 exe 图标/版本信息所需）...')
  const url = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe'
  await new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-Command',
      `Invoke-WebRequest -Uri '${url}' -OutFile '${rceditPath}' -UseBasicParsing`,
    ], { stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`下载 rcedit-x64.exe 失败，退出码 ${String(code)}`))
    })
  })

  log('rcedit-x64.exe 下载完成，winCodeSign 缓存就绪')
}

async function main() {
  if (archiveLegacyOnly) {
    await archiveLegacyReleaseArtifacts()
    log('release 目录历史产物归档完成')
    return
  }

  if (includePlotRuntime) {
    await ensurePreparedRuntime()
  }

  if (verifyOnly) {
    await verifyPackagedResources(packagedResourcesRoot)
    if (includePlotRuntime) {
      log('plot runtime 校验通过')
    } else {
      log('当前为瘦身打包模式，默认不包含 plot-agent-runtime')
    }
    return
  }

  await archiveLegacyReleaseArtifacts()
  await removeStalePortableArtifacts()
  await buildIntroductionRemakeRenderer()
  await ensurePreparedVoskModel()

  log(`开始执行 electron-builder Windows 打包（仅 zip，${includePlotRuntime ? '含' : '不含'} plot-agent-runtime）`)
  await ensureWinCodeSignCache()
  await runElectronBuilder(['zip'])

  await verifyPackagedResources(packagedResourcesRoot)
  if (includePlotRuntime) {
    log('Windows 包校验通过，已确认包含内置 Python runtime 和本地绘图桥接脚本')
  } else {
    log('Windows 包校验通过，已确认当前瘦身包不含 plot-agent-runtime，绘图功能仅在外部 Python 环境可用')
  }
}

main().catch((error) => {
  process.stderr.write(`[package-win] ${error.message}\n`)
  process.exitCode = 1
})