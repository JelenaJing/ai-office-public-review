/**
 * registerBuiltins — 注册所有内置 Legacy Skill
 *
 * 在应用启动时（main.tsx 或 App.tsx 顶部）调用一次。
 * 幂等：多次调用只会覆盖相同 id 的 Skill，不会重复注册。
 */
import { registerSkill, setDefaultSkill } from './registry'
import { knowledgeWritingLegacySkill } from './builtins/knowledgeWritingLegacySkill'
import { paperGenerateLegacySkill } from './builtins/paperGenerateLegacySkill'
import { dailyReportGenerateLegacySkill } from './builtins/dailyReportGenerateLegacySkill'
import { templateDocumentGenerateLegacySkill } from './builtins/templateDocumentGenerateLegacySkill'
import { presentationGenerateLegacySkill } from './builtins/presentationGenerateLegacySkill'
import { imageGenerateLegacySkill } from './builtins/imageGenerateLegacySkill'
import { mailReplyDraftLegacySkill } from './builtins/mailReplyDraftLegacySkill'

export function registerBuiltins(): void {
  // --- Register all legacy skills ---
  registerSkill(knowledgeWritingLegacySkill)
  registerSkill(paperGenerateLegacySkill)
  registerSkill(dailyReportGenerateLegacySkill)
  registerSkill(templateDocumentGenerateLegacySkill)
  registerSkill(presentationGenerateLegacySkill)
  registerSkill(imageGenerateLegacySkill)
  registerSkill(mailReplyDraftLegacySkill)

  // --- Set default aliases ---
  // Aliases allow callers to use stable names (e.g. 'knowledge.writing.default')
  // that survive future Skill upgrades (swap legacy → v2 by changing only this file)
  setDefaultSkill('knowledge.writing.default', 'knowledge.writing.legacy')
  setDefaultSkill('paper.generate.default', 'paper.generate.legacy')
  setDefaultSkill('dailyReport.generate.default', 'dailyReport.generate.legacy')
  setDefaultSkill('templateDocument.generate.default', 'templateDocument.generate.legacy')
  setDefaultSkill('presentation.generate.default', 'presentation.generate.legacy')
  setDefaultSkill('image.generate.default', 'image.generate.legacy')
  setDefaultSkill('mail.replyDraft.default', 'mail.replyDraft.legacy')
}
