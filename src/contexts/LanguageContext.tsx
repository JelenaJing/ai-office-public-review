import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type AppLanguage = 'zh' | 'en'

interface LanguageState {
  language: AppLanguage
  setLanguage: (lang: AppLanguage) => void
  languageLabel: string
}

const LanguageContext = createContext<LanguageState | null>(null)

export function useLanguage(): LanguageState {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage 必须在 LanguageProvider 内使用')
  return ctx
}

const LABELS: Record<AppLanguage, string> = { zh: '中文', en: 'English' }

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() => (localStorage.getItem('ai_writer_language') as AppLanguage) || 'zh')
  const handleSetLanguage = useCallback((lang: AppLanguage) => {
    setLanguage(lang)
    localStorage.setItem('ai_writer_language', lang)
  }, [])
  const contextValue = useMemo(() => ({ language, setLanguage: handleSetLanguage, languageLabel: LABELS[language] }), [language, handleSetLanguage])
  return <LanguageContext.Provider value={contextValue}>{children}</LanguageContext.Provider>
}