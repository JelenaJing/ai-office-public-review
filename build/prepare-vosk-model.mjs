import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODEL_FILE_NAME = 'vosk-model-small-cn-0.3.tar.gz'
const DEFAULT_MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-cn-0.3.tar.gz'
const MIN_MODEL_SIZE_BYTES = 5 * 1024 * 1024

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputDir = path.join(projectRoot, 'build', 'vosk-models')
const outputPath = path.join(outputDir, MODEL_FILE_NAME)

function log(message) {
  process.stdout.write(`[prepare-vosk-model] ${message}\n`)
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureHealthyExistingModel() {
  if (!(await pathExists(outputPath))) {
    return false
  }

  const stat = await fs.stat(outputPath).catch(() => null)
  if (!stat || !stat.isFile() || stat.size < MIN_MODEL_SIZE_BYTES) {
    await fs.rm(outputPath, { force: true }).catch(() => undefined)
    return false
  }

  log(`复用已存在的模型归档: ${path.relative(projectRoot, outputPath)} (${stat.size} bytes)`)
  return true
}

function resolveSource() {
  const raw = String(process.env.AI_WRITER_VOSK_MODEL_SOURCE || '').trim()
  return raw || DEFAULT_MODEL_URL
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value)
}

function isFileUrl(value) {
  return /^file:\/\//i.test(value)
}

async function copyFromLocalPath(sourcePath) {
  const resolvedSourcePath = path.resolve(sourcePath)
  const stat = await fs.stat(resolvedSourcePath).catch(() => null)
  if (!stat || !stat.isFile()) {
    throw new Error(`本地模型文件不存在: ${resolvedSourcePath}`)
  }
  if (stat.size < MIN_MODEL_SIZE_BYTES) {
    throw new Error(`本地模型文件体积异常，拒绝使用: ${resolvedSourcePath}`)
  }

  await fs.mkdir(outputDir, { recursive: true })
  const tempPath = `${outputPath}.tmp`
  await fs.copyFile(resolvedSourcePath, tempPath)
  await fs.rename(tempPath, outputPath)
  log(`已从本地复制模型归档: ${resolvedSourcePath}`)
}

async function downloadFromUrl(sourceUrl) {
  log(`开始下载 Vosk 中文模型: ${sourceUrl}`)
  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`下载模型失败: HTTP ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (buffer.byteLength < MIN_MODEL_SIZE_BYTES) {
    throw new Error(`下载的模型归档体积异常，仅 ${buffer.byteLength} bytes`)
  }

  await fs.mkdir(outputDir, { recursive: true })
  const tempPath = `${outputPath}.tmp`
  await fs.writeFile(tempPath, buffer)
  await fs.rename(tempPath, outputPath)
  log(`模型归档已写入: ${path.relative(projectRoot, outputPath)}`)
}

async function main() {
  if (await ensureHealthyExistingModel()) {
    return
  }

  const source = resolveSource()
  if (isHttpUrl(source)) {
    await downloadFromUrl(source)
    return
  }

  if (isFileUrl(source)) {
    await copyFromLocalPath(fileURLToPath(source))
    return
  }

  await copyFromLocalPath(source)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[prepare-vosk-model] ${message}\n`)
  process.exitCode = 1
})
