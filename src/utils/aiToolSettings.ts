import type { AppSettings } from '../../electron/main/services/settingsStore'

export type ToolSettings = {
  rewriteLanguage: string
  rewriteRequirements: string
  refTopic: string
  refYearFrom: string
  refYearTo: string
  refTargetCount: number
  refSoftFloorPercent: number
  refCandidatePoolSize: number
  refAnalysisWindow: number
  continueGoal: string
  continueWords: number
  imageAspectRatio: string
  genLanguage: string
  genPaperType: string
  genNoImageMode: boolean
  genCitationMode: 'deferred' | 'inline'
  genYearFrom: string
  genYearTo: string
  genExtraContext: string
}

type StorageReader = Pick<Storage, 'getItem'>
type ToolSettingsEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

export type EffectiveGenerationProfile = {
  language: 'zh' | 'en'
  paperType: 'research' | 'review' | 'thesis_research'
}

const currentYear = new Date().getFullYear().toString()

export const FALLBACK_TOOL_SETTINGS: ToolSettings = {
  rewriteLanguage: 'auto',
  rewriteRequirements: '保持原意，增强学术表达与论证严谨性',
  refTopic: '',
  refYearFrom: '',
  refYearTo: '',
  refTargetCount: 36,
  refSoftFloorPercent: 80,
  refCandidatePoolSize: 500,
  refAnalysisWindow: 40,
  continueGoal: '保持学术风格自然续写',
  continueWords: 500,
  imageAspectRatio: '16:9',
  genLanguage: 'zh',
  genPaperType: 'review',
  genNoImageMode: false,
  genCitationMode: 'deferred',
  genYearFrom: '2021',
  genYearTo: currentYear,
  genExtraContext: '',
}

export function getAIToolSettings(storage: StorageReader = localStorage): ToolSettings {
  const legacyRefMaxResults = storage.getItem('ai_tool_ref_max_results') || ''
  const refTargetCountRaw = parseInt(storage.getItem('ai_tool_ref_target_count') || String(FALLBACK_TOOL_SETTINGS.refTargetCount), 10)
  const refSoftFloorPercentRaw = parseInt(storage.getItem('ai_tool_ref_soft_floor_percent') || String(FALLBACK_TOOL_SETTINGS.refSoftFloorPercent), 10)
  const refCandidatePoolSizeRaw = parseInt(storage.getItem('ai_tool_ref_candidate_pool_size') || legacyRefMaxResults || String(FALLBACK_TOOL_SETTINGS.refCandidatePoolSize), 10)
  const refAnalysisWindowRaw = parseInt(storage.getItem('ai_tool_ref_analysis_window') || String(FALLBACK_TOOL_SETTINGS.refAnalysisWindow), 10)

  return {
    rewriteLanguage: storage.getItem('ai_tool_rewrite_language') || FALLBACK_TOOL_SETTINGS.rewriteLanguage,
    rewriteRequirements: storage.getItem('ai_tool_rewrite_requirements') || FALLBACK_TOOL_SETTINGS.rewriteRequirements,
    refTopic: storage.getItem('ai_tool_ref_topic') || FALLBACK_TOOL_SETTINGS.refTopic,
    refYearFrom: storage.getItem('ai_tool_ref_year_from') || FALLBACK_TOOL_SETTINGS.refYearFrom,
    refYearTo: storage.getItem('ai_tool_ref_year_to') || FALLBACK_TOOL_SETTINGS.refYearTo,
    refTargetCount: Number.isFinite(refTargetCountRaw) ? Math.min(80, Math.max(1, refTargetCountRaw)) : FALLBACK_TOOL_SETTINGS.refTargetCount,
    refSoftFloorPercent: Number.isFinite(refSoftFloorPercentRaw) ? Math.min(100, Math.max(0, refSoftFloorPercentRaw)) : FALLBACK_TOOL_SETTINGS.refSoftFloorPercent,
    refCandidatePoolSize: Number.isFinite(refCandidatePoolSizeRaw) ? Math.min(1000, Math.max(20, refCandidatePoolSizeRaw)) : FALLBACK_TOOL_SETTINGS.refCandidatePoolSize,
    refAnalysisWindow: Number.isFinite(refAnalysisWindowRaw) ? Math.min(120, Math.max(5, refAnalysisWindowRaw)) : FALLBACK_TOOL_SETTINGS.refAnalysisWindow,
    continueGoal: storage.getItem('ai_tool_continue_goal') || FALLBACK_TOOL_SETTINGS.continueGoal,
    continueWords: parseInt(storage.getItem('ai_tool_continue_words') || String(FALLBACK_TOOL_SETTINGS.continueWords), 10),
    imageAspectRatio: storage.getItem('ai_tool_image_aspect_ratio') || FALLBACK_TOOL_SETTINGS.imageAspectRatio,
    genLanguage: storage.getItem('ai_tool_gen_language') || FALLBACK_TOOL_SETTINGS.genLanguage,
    genPaperType: storage.getItem('ai_tool_gen_paper_type') || FALLBACK_TOOL_SETTINGS.genPaperType,
    genNoImageMode: storage.getItem('ai_tool_gen_no_image_mode') === 'true',
    genCitationMode: storage.getItem('ai_tool_gen_citation_mode') === 'inline' ? 'inline' : FALLBACK_TOOL_SETTINGS.genCitationMode,
    genYearFrom: storage.getItem('ai_tool_gen_year_from') || FALLBACK_TOOL_SETTINGS.genYearFrom,
    genYearTo: storage.getItem('ai_tool_gen_year_to') || FALLBACK_TOOL_SETTINGS.genYearTo,
    genExtraContext: storage.getItem('ai_tool_gen_extra_context') || FALLBACK_TOOL_SETTINGS.genExtraContext,
  }
}

export function getEffectiveGenerationProfile(toolSettings: Pick<ToolSettings, 'genLanguage' | 'genPaperType'>): EffectiveGenerationProfile {
  return {
    language: toolSettings.genLanguage === 'en' ? 'en' : 'zh',
    paperType: toolSettings.genPaperType === 'research' || toolSettings.genPaperType === 'thesis_research' ? toolSettings.genPaperType : 'review',
  }
}

export function subscribeToAIToolSettingsUpdates(
  listener: (settings: ToolSettings) => void,
  eventTarget: ToolSettingsEventTarget = window,
  storage: StorageReader = localStorage,
): () => void {
  const handleSettingsUpdated = () => {
    listener(getAIToolSettings(storage))
  }
  eventTarget.addEventListener('ai-settings-updated', handleSettingsUpdated)
  return () => {
    eventTarget.removeEventListener('ai-settings-updated', handleSettingsUpdated)
  }
}

export function syncToolSettingsToLocalStorage(settings: AppSettings): void {
  localStorage.setItem('ai_tool_rewrite_language', 'auto')
  localStorage.setItem('ai_tool_rewrite_requirements', settings.defaults.rewriteRequirements)
  localStorage.setItem('ai_tool_ref_topic', settings.defaults.referenceTopic)
  localStorage.setItem('ai_tool_ref_year_from', settings.defaults.referenceYearFrom)
  localStorage.setItem('ai_tool_ref_year_to', settings.defaults.referenceYearTo)
  localStorage.setItem('ai_tool_ref_target_count', String(settings.defaults.referenceCount))
  localStorage.setItem('ai_tool_ref_soft_floor_percent', String(settings.defaults.referenceSoftFloorPercent))
  localStorage.setItem('ai_tool_ref_max_results', String(settings.defaults.referenceCandidatePoolSize))
  localStorage.setItem('ai_tool_ref_candidate_pool_size', String(settings.defaults.referenceCandidatePoolSize))
  localStorage.setItem('ai_tool_ref_analysis_window', String(settings.defaults.referenceAnalysisWindow))
  localStorage.setItem('ai_tool_continue_goal', settings.defaults.continueGoal)
  localStorage.setItem('ai_tool_continue_words', String(settings.defaults.targetWords))
  localStorage.setItem('ai_tool_image_aspect_ratio', settings.defaults.imageAspectRatio)
  localStorage.setItem('ai_tool_gen_language', settings.defaults.language)
  localStorage.setItem('ai_tool_gen_paper_type', settings.defaults.paperType)
  localStorage.setItem('ai_tool_gen_no_image_mode', String(settings.defaults.noImageMode))
  if (!localStorage.getItem('ai_tool_gen_citation_mode')) {
    localStorage.setItem('ai_tool_gen_citation_mode', FALLBACK_TOOL_SETTINGS.genCitationMode)
  }
  localStorage.setItem('ai_tool_gen_year_from', settings.defaults.yearFrom)
  localStorage.setItem('ai_tool_gen_year_to', settings.defaults.yearTo)
  localStorage.setItem('ai_tool_gen_extra_context', settings.defaults.extraContext)
}