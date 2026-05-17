import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getAIToolSettings, getEffectiveGenerationProfile, subscribeToAIToolSettingsUpdates } from '../src/utils/aiToolSettings'

class MemoryStorage {
  private readonly store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) || null : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

async function assertComponentIntegration(projectRoot: string): Promise<void> {
  const composerSource = await fs.readFile(path.join(projectRoot, 'src', 'components', 'GenerationComposer.tsx'), 'utf-8')
  const editorSource = await fs.readFile(path.join(projectRoot, 'src', 'components', 'EditorPanel.tsx'), 'utf-8')

  assert.match(composerSource, /subscribeToAIToolSettingsUpdates\(setSettings\)/, 'GenerationComposer 未订阅 AI 设置更新事件')
  assert.match(editorSource, /subscribeToAIToolSettingsUpdates\(setGenerationSettings\)/, 'EditorPanel 未订阅 AI 设置更新事件')
  assert.match(editorSource, /getEffectiveGenerationProfile\(generationSettings\)/, 'EditorPanel 仍未统一使用生成设置推导蓝图')
}

function assertSettingsSubscription(): void {
  const storage = new MemoryStorage()
  const eventTarget = new EventTarget()
  let observed = getAIToolSettings(storage)

  storage.setItem('ai_tool_gen_language', 'en')
  storage.setItem('ai_tool_gen_paper_type', 'research')
  observed = getAIToolSettings(storage)
  assert.equal(observed.genLanguage, 'en', '初始语言设置读取失败')
  assert.equal(observed.genPaperType, 'research', '初始论文类型设置读取失败')

  const dispose = subscribeToAIToolSettingsUpdates(
    (next) => {
      observed = next
    },
    eventTarget as unknown as Window,
    storage,
  )

  storage.setItem('ai_tool_gen_language', 'zh')
  storage.setItem('ai_tool_gen_paper_type', 'review')
  eventTarget.dispatchEvent(new Event('ai-settings-updated'))

  assert.equal(observed.genLanguage, 'zh', '设置更新事件后语言仍未刷新')
  assert.equal(observed.genPaperType, 'review', '设置更新事件后论文类型仍未刷新')

  const profile = getEffectiveGenerationProfile(observed)
  assert.deepEqual(profile, { language: 'zh', paperType: 'review' }, '统一生成配置未返回最新的综述中文设置')

  dispose()
}

async function main(): Promise<void> {
  const projectRoot = process.cwd()
  await assertComponentIntegration(projectRoot)
  assertSettingsSubscription()
  console.log('settings sync smoke passed')
}

main().catch((error) => {
  console.error('[smoke] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})