import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useDepartment } from './contexts/DepartmentContext'
import { KnowledgeChipBar } from './components/knowledge/KnowledgeChipBar'
import { KnowledgeTreePicker } from './components/knowledge/KnowledgeTreePicker'
import { useDocumentWorkspaceKnowledge } from './contexts/DocumentWorkspaceContext'
import WorkspaceViewportHost from './components/WorkspaceViewportHost'
import KnowledgeConversationDock from './modules/knowledge/components/KnowledgeConversationDock'
import { ChatWindow } from './modules/chat/ChatWindow'
import { useDocument } from './contexts/DocumentContext'
import { FormalTemplateSessionProvider } from './modules/formal/contexts/FormalTemplateSessionContext'
import { GenerationWorkbenchProvider } from './contexts/GenerationWorkbenchContext'
import { WorkspaceModeProvider, useWorkspaceMode } from './contexts/WorkspaceModeContext'
import { useLanguage } from './contexts/LanguageContext'
import { useWorkspace } from './contexts/WorkspaceContext'
import { syncToolSettingsToLocalStorage } from './utils/aiToolSettings'
import { TerminalSquare, X } from 'lucide-react'
import { DocumentEngineRuntimeProvider } from './engines/documentEngine/runtime'
import { DocumentEngineHostCommandsProvider } from './engines/documentEngine/hostCommands'
import { useGenerationWorkbench, type GenerationStatusPhase } from './contexts/GenerationWorkbenchContext'
import { useInternalSession, useInternalAccount } from './contexts/InternalAccountContext'
import { DelegationProvider } from './contexts/DelegationContext'
import DocumentFilePanel from './components/DocumentFilePanel'
import LoginGate from './components/LoginGate'
import ForceChangePasswordModal from './components/ForceChangePasswordModal'
import AddressBook from './components/AddressBook'
import WorkspaceGate from './pages/WorkspaceGate'
import PrimaryNav, { type PrimarySection } from './components/nav/PrimaryNav'
import HomeDashboard from './pages/HomeDashboard'
import WorkWorkspace from './pages/WorkWorkspace'
import StudyWorkspace from './pages/StudyWorkspace'
import LifeWorkspace from './pages/LifeWorkspace'
import ResourceWorkspace from './pages/ResourceWorkspace'
import SettingsView from './pages/SettingsView'
import AccountView from './pages/AccountView'
import SkillManagementView from './pages/SkillManagementView'
import CalendarWorkspace from './pages/CalendarWorkspace'
import { DISABLE_FORCE_PASSWORD_CHANGE } from './config'
import { DEFAULT_APP_ROUTE } from './config/productFeatures'

/** Derive the initial PrimarySection from the feature-flag default route (e.g. '/work' → 'work', '/' → 'home'). */
const DEFAULT_PRIMARY_SECTION = (DEFAULT_APP_ROUTE.replace(/^\//, '') || 'home') as import('./components/nav/PrimaryNav').PrimarySection

const IS_DEV = Boolean((import.meta as unknown as { env: Record<string, unknown> }).env?.DEV)
const SkillDevPanel = IS_DEV
  ? lazy(() => import('./components/skill/SkillDevPanel'))
  : null

const AppShell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #f7f8fb;
`

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`

const MainArea = styled.div`
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`

const CenterColumn = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const DocumentViewport = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
`

const LazyPanelFallback = styled.div`
  width: 380px;
  border-left: 1px solid #dde3ec;
  background: #ffffff;
  flex-shrink: 0;
`

const MainRow = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
`

const RightArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`

const WorkspaceArea = styled.div<{ $visible: boolean }>`
  flex: 1;
  display: ${p => p.$visible ? 'flex' : 'none'};
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`

const WorkspaceTopBar = styled.div`
  height: 44px;
  background: #1a2840;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 10px;
  flex-shrink: 0;
`

const WorkspaceBackBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px;
  background: rgba(255,255,255,0.08);
  color: rgba(200,220,240,0.9);
  font-size: var(--font-size-xs);
  cursor: pointer;
  flex-shrink: 0;
  &:hover { background: rgba(255,255,255,0.15); color: #fff; }
`

const WorkspaceModeLabel = styled.span`
  font-size: var(--font-size-sm);
  color: rgba(180,205,230,0.7);
  font-weight: 500;
  flex-shrink: 0;
`

const TopBarSpacer = styled.div`
  flex: 1;
`

const TopBarLabel = styled.span`
  font-size: var(--font-size-xs);
  color: rgba(180,205,230,0.65);
  flex-shrink: 0;
`

const TopBarDeptSelect = styled.select`
  height: 30px;
  padding: 0 4px 0 6px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px;
  background: rgba(40,60,90,0.8);
  color: rgba(200,220,240,0.9);
  font-size: var(--font-size-xs);
  cursor: pointer;
  max-width: 160px;
  &:focus { outline: none; }
  option { background: #1a2840; color: #e0f0ff; }
`

const TopBarDivider = styled.div`
  width: 1px;
  height: 18px;
  background: rgba(255,255,255,0.15);
  flex-shrink: 0;
`

const TopBarWorkspaceChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 8px 0 10px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  color: rgba(180,205,230,0.7);
  font-size: var(--font-size-xs);
  flex-shrink: 0;
`

const TopBarWorkspaceName = styled.span`
  font-weight: 600;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(220,235,250,0.95);
`

const TopBarSwitchBtn = styled.button`
  flex-shrink: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 3px;
  background: rgba(255,255,255,0.1);
  color: rgba(200,220,240,0.9);
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  &:hover { background: rgba(255,255,255,0.2); color: #fff; }
`

const ScenarioArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`

const StatusBar = styled.div`
  height: 30px;
  background: #ffffff;
  border-top: 1px solid #dde3ec;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: #304255;
`

const StatusLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const StatusRight = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const StatusItem = styled.span`
  cursor: pointer;
  padding: 0 4px;
  &:hover { background: #eef3f9; }
`

const StatusActionButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid ${p => p.$active ? '#9fc2e6' : '#cad6e2'};
  border-radius: 4px;
  background: ${p => p.$active ? '#eaf2fb' : '#ffffff'};
  color: #304255;
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:hover { background: #eef4fb; }
`

const UserStatusItem = styled.span`
  padding: 0 6px;
  font-size: var(--font-size-xs);
  color: #4a5f73;
  font-weight: 600;
`

const LogoutButton = styled.button`
  height: 26px;
  padding: 0 8px;
  border: 1px solid #e0c8c8;
  border-radius: 4px;
  background: #fff5f5;
  color: #a03030;
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:hover { background: #ffe8e8; }
`

const WorkspaceChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 6px 0 8px;
  border: 1px solid #c8d8ea;
  border-radius: 10px;
  background: #edf4fc;
  font-size: var(--font-size-xs);
  color: #2a4a6e;
  font-weight: 500;
  max-width: 180px;
  overflow: hidden;
`

const WorkspaceChipName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
`

const WorkspaceSwitchBtn = styled.button`
  flex-shrink: 0;
  height: 24px;
  padding: 0 7px;
  border: 1px solid #b0c8e0;
  border-radius: 7px;
  background: #ffffff;
  color: #1f6fd6;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #e8f0fb; }
`

const SettingsEntryBtn = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #cad6e2;
  border-radius: 4px;
  background: ${p => p.$active ? '#eaf2fb' : '#ffffff'};
  color: #304255;
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:hover { background: #eef4fb; }
`

const OutputDrawer = styled.div`
  height: 240px;
  border-top: 1px solid #dde3ec;
  background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
`

const OutputDrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid #e3e9f1;
`

const OutputDrawerTitleWrap = styled.div`
  min-width: 0;
  display: grid;
  gap: 4px;
`

const OutputDrawerTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  font-weight: 800;
  color: #1f3447;
`

const OutputDrawerHint = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #6e8295;
`

const OutputDrawerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const OutputDrawerAction = styled.button`
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: #f4f8fb;
  }
`

const OutputSummaryRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #e8edf3;

  @media (max-width: 1120px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const OutputSummaryCard = styled.div`
  min-width: 0;
  border: 1px solid #dce5ef;
  border-radius: 10px;
  background: #fbfdff;
  padding: 10px;
  display: grid;
  gap: 6px;
`

const OutputSummaryLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #7a8ea2;
`

const OutputSummaryValue = styled.div`
  min-width: 0;
  font-size: var(--font-size-xs);
  line-height: 1.55;
  color: #243447;
  font-weight: 700;
  word-break: break-word;
`

const OutputLogList = styled.div`
  min-height: 0;
  overflow: auto;
  padding: 10px 14px 14px;
  display: grid;
  gap: 8px;
`

const OutputLogItem = styled.div<{ $tone?: 'neutral' | 'running' | 'success' | 'error' }>`
  border: 1px solid ${({ $tone }) => ($tone === 'error' ? '#f0cccc' : $tone === 'success' ? '#cfead8' : $tone === 'running' ? '#cfe0f4' : '#dde5ee')};
  border-radius: 10px;
  background: ${({ $tone }) => ($tone === 'error' ? '#fff6f6' : $tone === 'success' ? '#f3fbf6' : $tone === 'running' ? '#f4f9ff' : '#ffffff')};
  padding: 10px 12px;
  display: grid;
  gap: 6px;
`

const OutputLogMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`

const OutputLogSource = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-xs);
  font-weight: 800;
  color: #4f6478;
`

const OutputLogTime = styled.div`
  font-size: var(--font-size-xs);
  color: #8093a6;
`

const OutputLogMessage = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.65;
  color: #233648;
  white-space: pre-wrap;
  word-break: break-word;
`

type OutputEntryTone = 'neutral' | 'running' | 'success' | 'error'

interface RuntimeOutputEntry {
  id: string
  source: string
  message: string
  createdAt: string
  tone: OutputEntryTone
  step?: number | null
}

const MAX_RUNTIME_OUTPUT_ENTRIES = 120

function formatGenerationModeLabel(mode: 'document' | 'image' | 'ppt' | 'email' | 'daily-report' | 'homework' | 'ai-class' | 'ai-forum' | 'paper' | 'data' | 'model' | 'daily-feed'): string {
  if (mode === 'document') return '文稿'
  if (mode === 'image') return '图片'
  if (mode === 'ppt') return 'PPT'
  if (mode === 'daily-report') return '日报'
  if (mode === 'homework') return '作业'
  if (mode === 'ai-class') return 'AI课堂'
  if (mode === 'ai-forum') return 'AI论坛'
  if (mode === 'paper') return '论文'
  if (mode === 'data') return '数据分析'
  if (mode === 'model') return '模型开发'
  if (mode === 'daily-feed') return '科学资讯'
  return '邮件'
}

function formatGenerationPhaseLabel(phase: GenerationStatusPhase): string {
  if (phase === 'running') return '运行中'
  if (phase === 'completed') return '已完成'
  if (phase === 'error') return '出错'
  return '空闲'
}

function formatAiScopeLabel(scope?: string): string {
  if (scope === 'paper') return '论文任务'
  if (scope === 'image') return '图片任务'
  if (scope === 'assistant') return '写作助手'
  if (scope === 'continue') return '续写任务'
  if (scope === 'rewrite') return '改写任务'
  return 'AI任务'
}

function formatOutputTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

const LangSelect = styled.select`
  padding: 1px 4px;
  border: none;
  background: transparent;
  color: #304255;
  font-size: var(--font-size-xs);
  cursor: pointer;
  outline: none;
  option { background: #ffffff; color: #304255; }
`

const Launcher = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 32px;
`

const LauncherTitle = styled.h1`
  margin: 0 0 8px;
  font-size: 28px;
  color: #1f3142;
`

interface WriterWorkspaceRuntimeProps {
  statusMessage: string
  runtimeStatus: string
  activeWorkspacePath: string | null
  closeWorkspace: () => void
  language: 'zh' | 'en'
  setLanguage: (language: 'zh' | 'en') => void
  markdown: string
  onLogout: () => void
}

function WriterWorkspaceRuntime({
  statusMessage,
  runtimeStatus,
  activeWorkspacePath,
  closeWorkspace,
  language,
  setLanguage,
  markdown,
  onLogout,
}: WriterWorkspaceRuntimeProps) {
  const { mode, currentMode, generationMode } = useWorkspaceMode()
  const { generationStatus } = useGenerationWorkbench()
  const { departments, selectedDepartmentId, selectDepartment, loading: deptLoading } = useDepartment()
  const internalSession = useInternalSession()
  const internalUsername = internalSession?.user?.username
  const { activeWorkspaceName } = useWorkspace()
  const [primarySection, setPrimarySection] = useState<PrimarySection>(DEFAULT_PRIMARY_SECTION)
  const [returnToScene, setReturnToScene] = useState<PrimarySection>(DEFAULT_PRIMARY_SECTION)

  const navigateTo = useCallback((section: PrimarySection) => {
    setPrimarySection(section)
  }, [])

  const goToWorkspace = useCallback(() => {
    setReturnToScene(primarySection)
    setPrimarySection('workspace')
  }, [primarySection])
  const [outputPanelOpen, setOutputPanelOpen] = useState(false)
  const [outputEntries, setOutputEntries] = useState<RuntimeOutputEntry[]>([])
  const [latestAiStep, setLatestAiStep] = useState<number | null>(null)
  const [skillDevPanelOpen, setSkillDevPanelOpen] = useState(false)

  // Multi-select knowledge base state — persisted per generation mode
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>(() => {
    try {
      const key = `aioffice.kbSelection.${generationMode}`
      const stored = localStorage.getItem(key)
      if (stored) return JSON.parse(stored) as string[]
    } catch {}
    return selectedDepartmentId ? [selectedDepartmentId] : []
  })
  const [kbPickerOpen, setKbPickerOpen] = useState(false)

  // Sync selectedKbIds when generationMode changes (load per-mode stored selection)
  useEffect(() => {
    try {
      const key = `aioffice.kbSelection.${generationMode}`
      const stored = localStorage.getItem(key)
      if (stored) {
        setSelectedKbIds(JSON.parse(stored) as string[])
        return
      }
    } catch {}
    setSelectedKbIds(selectedDepartmentId ? [selectedDepartmentId] : [])
  }, [generationMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep DepartmentContext single-select in sync with first selected KB
  useEffect(() => {
    const primary = selectedKbIds[0]
    if (primary && primary !== selectedDepartmentId) {
      selectDepartment(primary)
    }
  }, [selectedKbIds, selectedDepartmentId, selectDepartment])

  const handleKbApply = useCallback((ids: string[]) => {
    setSelectedKbIds(ids)
    setKbPickerOpen(false)
    try {
      const key = `aioffice.kbSelection.${generationMode}`
      localStorage.setItem(key, JSON.stringify(ids))
    } catch {}
  }, [generationMode])

  // Document workspace (free mode) knowledge base state
  const { workspaceKbIds, setWorkspaceKbIds } = useDocumentWorkspaceKnowledge()
  const [docKbPickerOpen, setDocKbPickerOpen] = useState(false)

  const handleDocKbApply = useCallback((ids: string[]) => {
    setWorkspaceKbIds(ids)
    setDocKbPickerOpen(false)
  }, [setWorkspaceKbIds])

  const appendOutputEntry = useCallback((entry: Omit<RuntimeOutputEntry, 'id' | 'createdAt'> & { createdAt?: string }) => {
    const createdAt = entry.createdAt || new Date().toISOString()
    setOutputEntries((prev) => {
      const nextEntry: RuntimeOutputEntry = {
        ...entry,
        createdAt,
        id: `${createdAt}-${prev.length}`,
      }
      const previous = prev[prev.length - 1]
      if (
        previous
        && previous.source === nextEntry.source
        && previous.message === nextEntry.message
        && (previous.step ?? null) === (nextEntry.step ?? null)
      ) {
        return prev
      }
      return [...prev, nextEntry].slice(-MAX_RUNTIME_OUTPUT_ENTRIES)
    })
  }, [])

  useEffect(() => {
    appendOutputEntry({
      source: '工作台',
      message: `已切换到${formatGenerationModeLabel(generationMode)}模式`,
      tone: 'neutral',
    })
  }, [appendOutputEntry, generationMode])

  useEffect(() => {
    if (!statusMessage.trim()) return
    appendOutputEntry({
      source: '状态栏',
      message: statusMessage,
      tone: statusMessage.includes('失败') || statusMessage.includes('出错') ? 'error' : 'neutral',
    })
  }, [appendOutputEntry, statusMessage])

  useEffect(() => {
    if (!generationStatus.message.trim()) return
    appendOutputEntry({
      source: `${formatGenerationModeLabel(currentMode)}流程`,
      message: generationStatus.message,
      tone: generationStatus.phase === 'error'
        ? 'error'
        : generationStatus.phase === 'completed'
          ? 'success'
          : generationStatus.phase === 'running'
            ? 'running'
            : 'neutral',
      createdAt: generationStatus.updatedAt || undefined,
    })
  }, [appendOutputEntry, currentMode, generationStatus])

  useEffect(() => {
    const electronApi = window.electronAPI
    if (!electronApi?.onAiEvent) return
    const unsubscribe = electronApi.onAiEvent((payload) => {
      const event = payload as { scope?: string; type?: string; message?: string; step?: number }
      const type = String(event.type || '').trim()
      if (!['start', 'status', 'progress', 'done', 'error'].includes(type)) return
      const step = typeof event.step === 'number' && Number.isFinite(event.step) ? event.step : null
      if (step !== null) setLatestAiStep(step)

      let message = String(event.message || '').trim()
      if (!message) {
        if (type === 'start') message = '任务已启动'
        else if (type === 'done') message = '任务已完成'
        else if (type === 'error') message = '任务执行失败'
      }
      if (!message) return

      appendOutputEntry({
        source: formatAiScopeLabel(event.scope),
        message,
        tone: type === 'error' ? 'error' : type === 'done' ? 'success' : 'running',
        step,
      })
    })
    return () => unsubscribe()
  }, [appendOutputEntry])

  // Allow any component to open the chat section via custom event.
  useEffect(() => {
    const handler = () => navigateTo('chat')
    window.addEventListener('open-chat-window', handler)
    return () => window.removeEventListener('open-chat-window', handler)
  }, [navigateTo])

  // Allow any component to open the account panel via custom event (e.g. from ChatWindow login guard).
  useEffect(() => {
    const handler = () => navigateTo('account')
    window.addEventListener('open-account-center', handler)
    return () => window.removeEventListener('open-account-center', handler)
  }, [navigateTo])

  useEffect(() => {
    const handler = () => navigateTo('calendar')
    window.addEventListener('open-calendar-workspace', handler)
    return () => window.removeEventListener('open-calendar-workspace', handler)
  }, [navigateTo])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; subject?: string }>).detail
      goToWorkspace()
      window.dispatchEvent(new CustomEvent('open-communication-workbench'))
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-communication-workbench'))
        window.dispatchEvent(new CustomEvent('open-calendar-source-mail-select', { detail }))
      }, 0)
    }
    window.addEventListener('open-calendar-source-mail', handler)
    return () => window.removeEventListener('open-calendar-source-mail', handler)
  }, [goToWorkspace])

  // Navigate to workspace email section when any component dispatches open-email-compose.
  // The pending recipient is stored in pendingEmailCompose singleton and consumed by CommunicationWorkbench.
  useEffect(() => {
    const handler = () => {
      goToWorkspace()
      window.dispatchEvent(new CustomEvent('open-communication-workbench'))
    }
    window.addEventListener('open-email-compose', handler)
    return () => window.removeEventListener('open-email-compose', handler)
  }, [goToWorkspace])

  // Handle open-sidebar-tab events from legacy editor components — redirect to standalone pages.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail
      if (detail?.tab === 'account') navigateTo('account')
      else if (detail?.tab === 'settings' || detail?.tab === 'image' || detail?.tab === 'tools') navigateTo('settings')
    }
    window.addEventListener('open-sidebar-tab', handler)
    return () => window.removeEventListener('open-sidebar-tab', handler)
  }, [navigateTo])

  const latestOutputEntry = outputEntries[outputEntries.length - 1] || null
  const currentOutputMessage = generationStatus.message || statusMessage || runtimeStatus || '当前没有新的输出'
  const currentStepLabel = latestAiStep !== null ? `步骤 ${latestAiStep}` : generationStatus.phase === 'running' ? '进行中' : '未开始'

  const outputSummary = useMemo(() => ([
    { label: '当前模式', value: formatGenerationModeLabel(currentMode) },
    { label: '当前阶段', value: formatGenerationPhaseLabel(generationStatus.phase) },
    { label: '当前步骤', value: currentStepLabel },
    { label: '最新输出', value: currentOutputMessage },
  ]), [currentMode, currentOutputMessage, currentStepLabel, generationStatus.phase])

  return (
    <>
      <MainRow>
        <PrimaryNav
          section={primarySection}
          onNavigate={navigateTo}
          username={internalUsername}
        />
        <RightArea>
          {primarySection === 'home' && (
            <ScenarioArea>
              <HomeDashboard onNavigate={navigateTo} />
            </ScenarioArea>
          )}
          {primarySection === 'work' && (
            <ScenarioArea>
              <WorkWorkspace onGoToWorkspace={goToWorkspace} onNavigate={navigateTo} />
            </ScenarioArea>
          )}
          {primarySection === 'calendar' && (
            <ScenarioArea>
              <CalendarWorkspace />
            </ScenarioArea>
          )}
          {primarySection === 'study' && (
            <ScenarioArea>
              <StudyWorkspace onGoToWorkspace={goToWorkspace} />
            </ScenarioArea>
          )}
          {primarySection === 'life' && (
            <ScenarioArea>
              <LifeWorkspace onGoToWorkspace={goToWorkspace} />
            </ScenarioArea>
          )}
          {primarySection === 'resource' && (
            <ScenarioArea>
              <ResourceWorkspace onGoToWorkspace={goToWorkspace} />
            </ScenarioArea>
          )}
          {primarySection === 'chat' && (
            <ScenarioArea>
              <ChatWindow inline onClose={() => navigateTo(DEFAULT_PRIMARY_SECTION)} />
            </ScenarioArea>
          )}
          {primarySection === 'contacts' && (
            <ScenarioArea>
              <AddressBook />
            </ScenarioArea>
          )}
          {primarySection === 'settings' && (
            <ScenarioArea>
              <SettingsView />
            </ScenarioArea>
          )}
          {primarySection === 'account' && (
            <ScenarioArea>
              <AccountView />
            </ScenarioArea>
          )}
          {primarySection === 'skill-center' && (
            <ScenarioArea>
              <SkillManagementView />
            </ScenarioArea>
          )}
          <WorkspaceArea $visible={primarySection === 'workspace'}>
            <WorkspaceTopBar>
              <WorkspaceBackBtn onClick={() => navigateTo(returnToScene)}>← 返回</WorkspaceBackBtn>
              <WorkspaceModeLabel>
                {mode === 'free'
                  ? '文稿'
                  : formatGenerationModeLabel(generationMode)}
              </WorkspaceModeLabel>
              <TopBarSpacer />
              {mode === 'free' && (
                <KnowledgeChipBar
                  departments={departments}
                  selectedIds={workspaceKbIds}
                  loading={deptLoading}
                  error={null}
                  onOpenPicker={() => setDocKbPickerOpen(true)}
                />
              )}
              {mode !== 'free'
                && generationMode !== 'email'
                && generationMode !== 'document'
                && generationMode !== 'ai-class'
                && generationMode !== 'ai-forum'
                && generationMode !== 'data'
                && generationMode !== 'model'
                && generationMode !== 'daily-feed' && (
                <KnowledgeChipBar
                  departments={departments}
                  selectedIds={selectedKbIds}
                  loading={deptLoading}
                  error={null}
                  onOpenPicker={() => setKbPickerOpen(true)}
                />
              )}
              {mode === 'generation' && generationMode === 'document' && (
                <>
                  <TopBarLabel>模板</TopBarLabel>
                  <TopBarDeptSelect value="" onChange={() => {}}>
                    <option value="">无模板</option>
                    <option disabled>通知（待接入）</option>
                    <option disabled>工作报告（待接入）</option>
                    <option disabled>会议纪要（待接入）</option>
                    <option disabled>公文（待接入）</option>
                  </TopBarDeptSelect>
                </>
              )}
              <TopBarDivider />
              {activeWorkspaceName && (
                <TopBarWorkspaceChip title={activeWorkspacePath ?? ''}>
                  <TopBarLabel>工作区</TopBarLabel>
                  <TopBarWorkspaceName>{activeWorkspaceName}</TopBarWorkspaceName>
                  <TopBarSwitchBtn onClick={closeWorkspace}>切换</TopBarSwitchBtn>
                </TopBarWorkspaceChip>
              )}
            </WorkspaceTopBar>
            <MainArea>
              {mode === 'free' && <DocumentFilePanel />}
              <CenterColumn>
                <DocumentViewport>
                  <WorkspaceViewportHost ghostTextEnabled={false} />
                </DocumentViewport>
                {mode !== 'free' && generationMode !== 'ai-class' && generationMode !== 'ai-forum' && generationMode !== 'daily-feed' && <KnowledgeConversationDock />}
              </CenterColumn>
            </MainArea>
          </WorkspaceArea>
        </RightArea>
      </MainRow>
      {kbPickerOpen && (
        <KnowledgeTreePicker
          departments={departments}
          selectedIds={selectedKbIds}
          onApply={handleKbApply}
          onClose={() => setKbPickerOpen(false)}
        />
      )}
      {docKbPickerOpen && (
        <KnowledgeTreePicker
          departments={departments}
          selectedIds={workspaceKbIds}
          onApply={handleDocKbApply}
          onClose={() => setDocKbPickerOpen(false)}
          title="选择文稿知识库"
        />
      )}
      {IS_DEV && outputPanelOpen ? (
        <OutputDrawer data-testid="runtime-output-drawer">
          <OutputDrawerHeader>
            <OutputDrawerTitleWrap>
              <OutputDrawerTitle><TerminalSquare size={15} /> 终端输出</OutputDrawerTitle>
              <OutputDrawerHint>集中展示当前任务输出、阶段状态和最近的 AI 运行记录，方便测试时看现在卡在哪一步。</OutputDrawerHint>
            </OutputDrawerTitleWrap>
            <OutputDrawerActions>
              <OutputDrawerAction type="button" onClick={() => setOutputEntries([])}>清空记录</OutputDrawerAction>
              <OutputDrawerAction type="button" onClick={() => setOutputPanelOpen(false)} title="收起输出面板"><X size={14} /></OutputDrawerAction>
            </OutputDrawerActions>
          </OutputDrawerHeader>
          <OutputSummaryRow>
            {outputSummary.map((item) => (
              <OutputSummaryCard key={item.label}>
                <OutputSummaryLabel>{item.label}</OutputSummaryLabel>
                <OutputSummaryValue>{item.value}</OutputSummaryValue>
              </OutputSummaryCard>
            ))}
          </OutputSummaryRow>
          <OutputLogList>
            {outputEntries.length > 0 ? outputEntries.slice().reverse().map((entry) => (
              <OutputLogItem key={entry.id} $tone={entry.tone}>
                <OutputLogMeta>
                  <OutputLogSource>
                    <span>{entry.source}</span>
                    {typeof entry.step === 'number' ? <span>步骤 {entry.step}</span> : null}
                  </OutputLogSource>
                  <OutputLogTime>{formatOutputTimestamp(entry.createdAt)}</OutputLogTime>
                </OutputLogMeta>
                <OutputLogMessage>{entry.message}</OutputLogMessage>
              </OutputLogItem>
            )) : (
              <OutputLogItem>
                <OutputLogMessage>{latestOutputEntry ? latestOutputEntry.message : '当前还没有输出记录。开始生成、导入或切换流程后，这里会持续追加状态。'}</OutputLogMessage>
              </OutputLogItem>
            )}
          </OutputLogList>
        </OutputDrawer>
      ) : null}
      {IS_DEV && skillDevPanelOpen && SkillDevPanel && (
        <Suspense fallback={null}>
          <SkillDevPanel onClose={() => setSkillDevPanelOpen(false)} />
        </Suspense>
      )}
      <StatusBar>
        <StatusLeft>
          {activeWorkspacePath && activeWorkspaceName && (
            <WorkspaceChip title={activeWorkspacePath}>
              <WorkspaceChipName>{activeWorkspaceName}</WorkspaceChipName>
              <WorkspaceSwitchBtn onClick={closeWorkspace} title="切换工作区">切换</WorkspaceSwitchBtn>
            </WorkspaceChip>
          )}
        </StatusLeft>
        <StatusRight>
          {IS_DEV && (
            <StatusActionButton type="button" $active={outputPanelOpen} onClick={() => setOutputPanelOpen((value) => !value)} title={outputPanelOpen ? '收起调试输出面板' : '打开调试输出面板'}>
              <TerminalSquare size={13} /> 调试输出
            </StatusActionButton>
          )}
          {IS_DEV && (
            <StatusActionButton type="button" $active={skillDevPanelOpen} onClick={() => setSkillDevPanelOpen((v) => !v)} title="Skill Dev Panel">
              🧠 Skills
            </StatusActionButton>
          )}
          <StatusItem title="AI-Office 3.0">AI-Office 3.0</StatusItem>
          <LangSelect value={language} onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </LangSelect>
          {internalUsername && <UserStatusItem>{internalUsername}</UserStatusItem>}
          <LogoutButton type="button" onClick={onLogout} title="退出登录">退出</LogoutButton>
        </StatusRight>
      </StatusBar>
    </>
  )
}

function WriterWorkspaceApp({ onLogout }: { onLogout: () => void }) {
  const { markdown, statusMessage, setStatusMessage } = useDocument()
  const { language, setLanguage } = useLanguage()
  const { initialized, activeWorkspacePath, closeWorkspace } = useWorkspace()
  const internalSession = useInternalSession()
  const [runtimeStatus, setRuntimeStatus] = useState('本地模式已就绪')

  useEffect(() => {
    const electronApi = window.electronAPI
    const unsubscribe = electronApi?.onAiEvent
      ? electronApi.onAiEvent((payload) => {
      const event = payload as { scope?: string; type?: string; message?: string; step?: number }
      const scopeLabel: Record<string, string> = {
        paper: '论文',
        'paper-section': '论文',
        'daily-report': '日报',
        'essay-writing': '散文',
        image: '图片',
        continue: '续写',
        rewrite: '重写',
      }
      if ((event.type === 'progress' || event.type === 'content' || event.type === 'status') && event.message) {
        const nextRuntimeStatus = `${scopeLabel[event.scope || ''] || 'AI'}: ${event.message}`
        setRuntimeStatus(nextRuntimeStatus)
        setStatusMessage(nextRuntimeStatus)
      } else if (event.type === 'start' && event.scope) {
        const nextRuntimeStatus = `${scopeLabel[event.scope] || 'AI'}任务启动`
        setRuntimeStatus(nextRuntimeStatus)
        setStatusMessage(nextRuntimeStatus)
      } else if (event.type === 'done' && event.scope) {
        const nextRuntimeStatus = `${scopeLabel[event.scope] || 'AI'}任务已完成`
        setRuntimeStatus(nextRuntimeStatus)
        setStatusMessage(nextRuntimeStatus)
      }
      })
      : () => {}
    return () => { unsubscribe() }
  }, [setStatusMessage])

  useEffect(() => {
    const electronApi = window.electronAPI
    if (!electronApi?.getSettings) return
    void electronApi.getSettings().then((settings) => {
      syncToolSettingsToLocalStorage(settings)
    }).catch(() => undefined)
  }, [])

  // Auto-snapshot + diff enqueue: fire silently when workspace opens so server has fresh data
  useEffect(() => {
    if (!activeWorkspacePath) return
    const api = window.electronAPI
    if (!api?.activityTakeSnapshot) return
    const workspacePath = activeWorkspacePath
    void api.activityTakeSnapshot(workspacePath)
      .then(() => {
        // Enqueue diff silently after snapshot completes
        void api.activityGetActivity?.({ workspacePath }).catch(() => {/* silent */})
      })
      .catch(() => {/* silent */})
  }, [activeWorkspacePath])

  if (!initialized) {
    return <AppShell><Launcher><LauncherTitle>正在加载工作区...</LauncherTitle></Launcher></AppShell>
  }

  if (!activeWorkspacePath) {
    return <WorkspaceGate />
  }

  return (
    <DelegationProvider
      userId={internalSession?.user?.id ?? null}
      username={internalSession?.user?.username ?? null}
      activeWorkspacePath={activeWorkspacePath}
    >
      <AppShell>
        <DocumentEngineRuntimeProvider>
          <DocumentEngineHostCommandsProvider>
            <WorkspaceModeProvider>
              <FormalTemplateSessionProvider>
                <GenerationWorkbenchProvider>
                  <WriterWorkspaceRuntime
                    statusMessage={statusMessage}
                    runtimeStatus={runtimeStatus}
                    activeWorkspacePath={activeWorkspacePath}
                    closeWorkspace={closeWorkspace}
                    language={language}
                    setLanguage={setLanguage}
                    markdown={markdown}
                    onLogout={onLogout}
                  />
                </GenerationWorkbenchProvider>
              </FormalTemplateSessionProvider>
            </WorkspaceModeProvider>
          </DocumentEngineHostCommandsProvider>
        </DocumentEngineRuntimeProvider>
      </AppShell>
    </DelegationProvider>
  )
}

// Startup splash shown while token validation is in progress
const StartupSplash = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(135deg, #eef2f8 0%, #f5f8fc 60%, #e8eef7 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
  font-size: 18px;
  color: #4a5f73;
`

export default function App() {
  const { state, logout } = useInternalAccount()
  const effectiveLoggedIn =
    state.phase === 'logged_in' ||
    (state.phase === 'must_change_password' && DISABLE_FORCE_PASSWORD_CHANGE)

  // DEV-only skip flag
  const devSkip = (import.meta as any).env?.DEV && localStorage.getItem('AIOFFICE_SKIP_LOGIN') === '1'

  if (!devSkip) {
    if (state.phase === 'restoring') {
      return <StartupSplash>AI Office · 正在启动...</StartupSplash>
    }
    if (state.phase === 'must_change_password' && !DISABLE_FORCE_PASSWORD_CHANGE) {
      return <ForceChangePasswordModal />
    }
    if (!effectiveLoggedIn) {
      return <LoginGate />
    }
  }

  return <WriterWorkspaceApp onLogout={logout} />
}
