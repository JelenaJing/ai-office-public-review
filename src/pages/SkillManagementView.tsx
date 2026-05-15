import React from 'react'
import styled from 'styled-components'
import { listSkills } from '../skills'

// ── Layout shells ─────────────────────────────────────────────────────────────

const ViewWrapper = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #f4f7fb;
`

const TabBar = styled.div`
  display: flex;
  align-items: stretch;
  border-bottom: 2px solid #e0e8f2;
  background: #ffffff;
  flex-shrink: 0;
  padding: 0 24px;
`

const TabBtn = styled.button<{ $active: boolean }>`
  padding: 13px 22px;
  border: none;
  border-bottom: ${p => p.$active ? '3px solid #1a5fb4' : '3px solid transparent'};
  margin-bottom: -2px;
  background: transparent;
  color: ${p => p.$active ? '#1a5fb4' : '#627385'};
  font-size: 14px;
  font-weight: ${p => p.$active ? '700' : '500'};
  cursor: pointer;
  transition: color 0.13s;
  white-space: nowrap;
  &:hover { color: #1a5fb4; }
  &:disabled { color: #aab4c0; cursor: not-allowed; }
`

const TabHint = styled.span`
  align-self: center;
  margin-left: 12px;
  font-size: var(--font-size-xs);
  color: #8a9ab0;
`

const TabErrHint = styled.span`
  align-self: center;
  margin-left: 12px;
  font-size: var(--font-size-xs);
  color: #c0392b;
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TabContent = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const PageSlot = styled.div<{ $active: boolean }>`
  display: ${p => p.$active ? 'flex' : 'none'};
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
`

const ManageScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 40px;
`

const StoreFrame = styled.iframe`
  flex: 1;
  width: 100%;
  min-height: 0;
  border: none;
  display: block;
  background: #fff;
`

const StoreStateArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #627385;
  font-size: 14px;
  padding: 40px;
`

const RetryBtn = styled.button`
  padding: 7px 22px;
  background: #1a5fb4;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #154e9c; }
`

// ── Registered-skill list (local registry) ───────────────────────────────────

const SkillList = styled.div`
  display: grid;
  gap: 10px;
`

const SkillCard = styled.div`
  border: 1px solid #dde3ec;
  border-radius: 8px;
  padding: 12px 14px;
  background: #ffffff;
`

const SkillName = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #1f3142;
`

const SkillMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #627385;
  margin-top: 4px;
`

const SkillId = styled.code`
  font-size: var(--font-size-xs);
  background: #f0f4fa;
  border-radius: 4px;
  padding: 1px 6px;
  color: #3563a0;
`

// ── Skill management panel ────────────────────────────────────────────────────

type SkillPlanStatus = 'to_install' | 'to_update' | 'already_latest' | 'to_disable'

interface SkillPlanRow {
  skill_id: string
  package_id?: string
  current_version?: string
  target_version: string
  status: SkillPlanStatus
  display_name?: string
  description?: string
}

interface MySkinItem {
  skill_id: string
  name: string
  description?: string
  version: string
  package_id: string | null
  package_hash: string | null
  package_file: string | null
  size: number
  download_available: boolean
}

type RawEnt  = Record<string, unknown>
type RawInst = { skill_id?: unknown; version?: unknown; package_id?: unknown }
type RawUpd  = { skill_id?: unknown; from_version?: unknown; to_version?: unknown; package_id?: unknown }
type RawLat  = { skill_id?: unknown; version?: unknown }
type RawDis  = { skill_id?: unknown; version?: unknown; package_id?: unknown }

function buildSkillPlanRows(
  plan: { to_install?: unknown[]; to_update?: unknown[]; to_disable?: unknown[]; already_latest?: unknown[] } | null | undefined,
  entitlements: unknown[] | null,
): SkillPlanRow[] {
  const nameMap = new Map<string, string>()
  const descMap = new Map<string, string>()
  for (const e of (entitlements ?? []) as RawEnt[]) {
    const id = String(e.skill_id ?? '')
    if (id) { nameMap.set(id, String(e.name ?? id)); descMap.set(id, String(e.description ?? '')) }
  }
  const rows: SkillPlanRow[] = []
  const seen = new Set<string>()
  for (const item of (plan?.to_install ?? []) as RawInst[]) {
    const id = String(item.skill_id ?? ''); if (!id || seen.has(id)) continue; seen.add(id)
    rows.push({ skill_id: id, package_id: String(item.package_id ?? ''), target_version: String(item.version ?? ''), status: 'to_install', display_name: nameMap.get(id), description: descMap.get(id) })
  }
  for (const item of (plan?.to_update ?? []) as RawUpd[]) {
    const id = String(item.skill_id ?? ''); if (!id || seen.has(id)) continue; seen.add(id)
    rows.push({ skill_id: id, package_id: String(item.package_id ?? ''), current_version: String(item.from_version ?? ''), target_version: String(item.to_version ?? ''), status: 'to_update', display_name: nameMap.get(id), description: descMap.get(id) })
  }
  for (const item of (plan?.already_latest ?? []) as RawLat[]) {
    const id = String(item.skill_id ?? ''); if (!id || seen.has(id)) continue; seen.add(id)
    rows.push({ skill_id: id, target_version: String(item.version ?? ''), current_version: String(item.version ?? ''), status: 'already_latest', display_name: nameMap.get(id), description: descMap.get(id) })
  }
  for (const item of (plan?.to_disable ?? []) as RawDis[]) {
    const id = String(item.skill_id ?? ''); if (!id || seen.has(id)) continue; seen.add(id)
    rows.push({ skill_id: id, package_id: String(item.package_id ?? ''), current_version: String(item.version ?? ''), target_version: String(item.version ?? ''), status: 'to_disable', display_name: nameMap.get(id), description: descMap.get(id) })
  }
  return rows
}

function skillPlanStatusLabel(s: SkillPlanStatus): string {
  return s === 'to_install' ? '已购待安装' : s === 'to_update' ? '待更新' : s === 'already_latest' ? '已是最新' : '已禁用'
}
function skillPlanActionLabel(s: SkillPlanStatus): string {
  return s === 'to_install' ? '安装' : s === 'to_update' ? '更新' : s === 'to_disable' ? '启用' : '管理'
}

function formatBytes(n: number): string {
  if (n <= 0) return ''
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// styled components for management panel
const MgmtToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
`
const CheckButton = styled.button`
  padding: 8px 20px;
  background: #2e7d32;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #256427; }
  &:disabled { background: #8fb890; cursor: not-allowed; }
`
const SummaryBadge = styled.span<{ $color: string }>`
  padding: 3px 10px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: ${p => p.$color};
  color: #fff;
`
const PlanStatusBadge = styled.span<{ $status: SkillPlanStatus }>`
  display: inline-block;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
  background: ${p =>
    p.$status === 'to_install'    ? '#e67700' :
    p.$status === 'to_update'     ? '#0066cc' :
    p.$status === 'already_latest'? '#2e7d32' : '#888'};
  color: #fff;
`
const MgmtCardGrid = styled.div`display: grid; gap: 8px;`
const MgmtCard = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: 10px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #dde3ec;
  border-radius: 8px;
`
const MgmtCardLeft = styled.div`min-width: 0;`
const MgmtCardName = styled.div`font-size: var(--font-size-sm); font-weight: 600; color: #1f3142; margin-bottom: 3px;`
const MgmtCardMeta = styled.div`font-size: var(--font-size-xs); color: #627385; line-height: 1.6;`
const MgmtCardRight = styled.div`display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0;`
const DisabledActionBtn = styled.button`
  padding: 5px 12px;
  font-size: var(--font-size-xs);
  border: 1px solid #dde3ec;
  border-radius: 6px;
  background: #f5f7fa;
  color: #aab4c0;
  cursor: not-allowed;
  white-space: nowrap;
`
const MgmtEmptyState = styled.div`
  padding: 28px 0;
  text-align: center;
  font-size: var(--font-size-sm);
  color: #8a9ab0;
`
const MgmtErrorMsg = styled.div`
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fff3cd;
  border: 1px solid #f0c040;
  border-radius: 6px;
  font-size: var(--font-size-xs);
  color: #7a5500;
  white-space: pre-wrap;
`
const RefreshButton = styled.button`
  padding: 8px 20px;
  background: #1a5fb4;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #154e9c; }
  &:disabled { background: #7fa8d8; cursor: not-allowed; }
`
const SkinCardGrid = styled.div`display: grid; gap: 8px; margin-top: 12px;`
const SkinCard = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: 10px;
  padding: 12px 14px;
  background: #f8fafe;
  border: 1px solid #d0ddf0;
  border-radius: 8px;
`
const SkinCardLeft = styled.div`min-width: 0;`
const SkinCardName = styled.div`font-size: var(--font-size-sm); font-weight: 700; color: #1a2e45; margin-bottom: 3px;`
const SkinCardMeta = styled.div`font-size: var(--font-size-xs); color: #5a6e85; line-height: 1.7;`
const SkinCardRight = styled.div`display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0;`
const DownloadBadge = styled.span<{ $available: boolean }>`
  padding: 2px 9px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: ${p => p.$available ? '#d4edda' : '#f8d7da'};
  color: ${p => p.$available ? '#1a6632' : '#842029'};
`
const SectionDivider = styled.div`
  margin: 20px 0 16px;
  border-top: 1px solid #e4e9f0;
  padding-top: 14px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #8a9ab0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`
const DownloadButton = styled.button<{ $available: boolean }>`
  padding: 5px 12px;
  font-size: var(--font-size-xs);
  border: 1px solid ${p => p.$available ? '#1a5fb4' : '#dde3ec'};
  border-radius: 6px;
  background: ${p => p.$available ? '#eef4ff' : '#f5f7fa'};
  color: ${p => p.$available ? '#1a5fb4' : '#aab4c0'};
  cursor: ${p => p.$available ? 'pointer' : 'not-allowed'};
  font-weight: ${p => p.$available ? '600' : '400'};
  white-space: nowrap;
  transition: background 0.12s;
  &:hover:not(:disabled) { background: #d8e8ff; }
  &:disabled { cursor: not-allowed; }
`
const DownloadedBadge = styled.div`
  font-size: var(--font-size-xs);
  color: #1a6632;
  background: #d4edda;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
const DownloadErrorMsg = styled.div`
  font-size: var(--font-size-xs);
  color: #842029;
  background: #f8d7da;
  padding: 2px 8px;
  border-radius: 6px;
  max-width: 200px;
  word-break: break-all;
`

// ── PPT template thumbnail preview ───────────────────────────────────────────
const PptThumbWrap = styled.div`
  flex-shrink: 0;
  width: 88px;
  height: 58px;
  border-radius: 5px;
  overflow: hidden;
  border: 1.5px solid #c8d4e8;
  background: #fff;
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
`
const PptThumbHeader = styled.div<{ $bg: string }>`
  flex-shrink: 0;
  height: 18px;
  background: ${p => p.$bg};
  display: flex;
  align-items: center;
  padding: 0 6px;
  gap: 3px;
`
const PptThumbAccent = styled.div<{ $bg: string }>`
  width: 3px;
  height: 10px;
  border-radius: 1px;
  background: ${p => p.$bg};
`
const PptThumbTitle = styled.div`
  flex: 1;
  height: 5px;
  border-radius: 2px;
  background: rgba(255,255,255,0.65);
`
const PptThumbBody = styled.div`
  flex: 1;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`
const PptThumbLine = styled.div<{ $w: string; $bg?: string }>`
  height: 4px;
  width: ${p => p.$w};
  border-radius: 2px;
  background: ${p => p.$bg ?? '#d0d8e6'};
`

/** Distinct thumbnail for each PPT template based on skill_id */
function PptTemplateThumbnail({ skillId }: { skillId: string }) {
  if (skillId === 'ppt_template_cuhk_business') {
    // CUHK green + gold palette
    return (
      <PptThumbWrap title="港中大商务汇报模板 – 绿色商务风">
        <PptThumbHeader $bg="#276221">
          <PptThumbAccent $bg="#d4a017" />
          <PptThumbTitle />
        </PptThumbHeader>
        <PptThumbBody>
          <PptThumbLine $w="70%" $bg="#276221" />
          <PptThumbLine $w="90%" />
          <PptThumbLine $w="80%" />
          <PptThumbLine $w="55%" $bg="#d4a017" />
        </PptThumbBody>
      </PptThumbWrap>
    )
  }
  if (skillId === 'ppt_template_academic_defense') {
    // Deep navy + gold academic palette
    return (
      <PptThumbWrap title="学术答辩模板 – 深蓝学术风">
        <PptThumbHeader $bg="#1a237e">
          <PptThumbAccent $bg="#FFC107" />
          <PptThumbTitle />
        </PptThumbHeader>
        <PptThumbBody>
          <PptThumbLine $w="65%" $bg="#1a237e" />
          <PptThumbLine $w="88%" />
          <PptThumbLine $w="75%" />
          <PptThumbLine $w="45%" $bg="#FFC107" />
        </PptThumbBody>
      </PptThumbWrap>
    )
  }
  return null
}

interface SkillDownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error'
  path?: string
  filename?: string
  error?: string
}

interface SkillRecogState {
  status: 'idle' | 'loading' | 'done' | 'error'
  skill_type?: string
  name?: string
  error?: string
}

function SkinCardRow({ skin }: { skin: MySkinItem }) {
  const [dlState, setDlState] = React.useState<SkillDownloadState>({ status: 'idle' })
  const [recogState, setRecogState] = React.useState<SkillRecogState>({ status: 'idle' })

  async function handleDownload() {
    setDlState({ status: 'downloading' })
    try {
      const result = await window.electronAPI.downloadSkillPackage?.({
        skillId: skin.skill_id,
        packageHash: skin.package_hash ?? undefined,
      })
      if (!result) {
        setDlState({ status: 'error', error: 'downloadSkillPackage 接口未暴露，请检查 preload 配置。' })
        return
      }
      if (result.ok) {
        setDlState({ status: 'done', path: result.path, filename: result.filename })
      } else {
        setDlState({ status: 'error', error: result.error })
      }
    } catch (e) {
      setDlState({ status: 'error', error: e instanceof Error ? e.message : '下载失败' })
    }
  }

  async function handleRecognize() {
    if (!dlState.path) return
    setRecogState({ status: 'loading' })
    try {
      const result = await window.electronAPI.recognizeSkillPackage?.({
        skillId: skin.skill_id,
        localPath: dlState.path,
      })
      if (!result) {
        setRecogState({ status: 'error', error: '识别接口未暴露，请检查 preload 配置。' })
        return
      }
      if (result.ok) {
        setRecogState({ status: 'done', skill_type: result.skill_type, name: result.name })
      } else {
        setRecogState({ status: 'error', error: result.error })
      }
    } catch (e) {
      setRecogState({ status: 'error', error: e instanceof Error ? e.message : '识别失败' })
    }
  }

  const isDownloading = dlState.status === 'downloading'
  const isDone       = dlState.status === 'done'

  return (
    <SkinCard>
      <SkinCardLeft>
        {skin.skill_id.startsWith('ppt_template') && (
          <PptTemplateThumbnail skillId={skin.skill_id} />
        )}
        <SkinCardName>{skin.name}</SkinCardName>
        <SkinCardMeta>
          ID：<SkillId>{skin.skill_id}</SkillId>
          &nbsp;&nbsp;版本：{skin.version}
        </SkinCardMeta>
        {skin.package_id && (
          <SkinCardMeta>包 ID：<SkillId>{skin.package_id}</SkillId></SkinCardMeta>
        )}
        {skin.package_hash && (
          <SkinCardMeta>Hash：<SkillId>{skin.package_hash.slice(0, 16)}…</SkillId></SkinCardMeta>
        )}
        {skin.package_file && (
          <SkinCardMeta>文件：{skin.package_file}{skin.size > 0 && ` (${formatBytes(skin.size)})`}</SkinCardMeta>
        )}
        {skin.description && <SkinCardMeta>{skin.description}</SkinCardMeta>}
        {isDone && dlState.filename && (
          <DownloadedBadge title={dlState.path}>✓ 已下载：{dlState.filename}</DownloadedBadge>
        )}
        {dlState.status === 'error' && (
          <DownloadErrorMsg>{dlState.error}</DownloadErrorMsg>
        )}
        {recogState.status === 'done' && (
          <DownloadedBadge>
            {recogState.skill_type === 'ppt_template' ? '🧩 PPT 模板 ✓' : `✓ 已识别：${recogState.skill_type ?? 'unknown'}`}
          </DownloadedBadge>
        )}
        {recogState.status === 'error' && (
          <DownloadErrorMsg>{recogState.error}</DownloadErrorMsg>
        )}
      </SkinCardLeft>
      <SkinCardRight>
        <DownloadBadge $available={skin.download_available}>
          {isDone ? '已下载' : skin.download_available ? '可下载' : '暂不可下载'}
        </DownloadBadge>
        <DownloadButton
          $available={skin.download_available && !isDownloading && !isDone}
          disabled={!skin.download_available || isDownloading || isDone}
          onClick={handleDownload}
          title={isDone ? `已保存至：${dlState.path}` : undefined}
        >
          {isDownloading ? '下载中...' : isDone ? '已下载 ✓' : '下载 Skill 包'}
        </DownloadButton>
        {isDone && recogState.status !== 'done' && (
          <DownloadButton
            $available={recogState.status !== 'loading'}
            disabled={recogState.status === 'loading'}
            onClick={() => { void handleRecognize() }}
          >
            {recogState.status === 'loading' ? '识别中...' : '识别并启用'}
          </DownloadButton>
        )}
        <DisabledActionBtn disabled title="下一阶段支持">安装</DisabledActionBtn>
        <DisabledActionBtn disabled title="下一阶段支持">启用/禁用</DisabledActionBtn>
      </SkinCardRight>
    </SkinCard>
  )
}

function SkillManagementPanel() {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<SkillPlanRow[] | null>(null)
  const [totalEnt, setTotalEnt] = React.useState(0)

  const [skinLoading, setSkinLoading] = React.useState(false)
  const [skinError, setSkinError] = React.useState<string | null>(null)
  const [skins, setSkins] = React.useState<MySkinItem[] | null>(null)

  async function handleCheck() {
    setError(null); setRows(null); setLoading(true)
    try {
      const result = await window.electronAPI.getSkillSyncPlan?.()
      if (!result) { setError('getSkillSyncPlan 接口未暴露，请检查 preload 配置。'); return }
      if (!result.ok) { setError(result.error ?? '检查失败，请确认 skill_platform_next 目录存在且依赖已安装。'); return }
      setRows(buildSkillPlanRows(result.plan, result.entitlements ?? null))
      setTotalEnt((result.entitlements ?? []).length)
    } catch (_e) {
      setError('检查已购 Skill 失败，请检查 skill_platform_next 目录是否存在且依赖已安装。')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setSkinError(null); setSkins(null); setSkinLoading(true)
    try {
      const result = await window.electronAPI.listMySkins?.()
      if (!result) { setSkinError('listMySkins 接口未暴露，请检查 preload 配置。'); return }
      if (!result.ok) { setSkinError(result.error ?? '获取已购 Skill 失败，请确认 skill_platform_next 目录存在且依赖已安装。'); return }
      setSkins(result.skins ?? [])
    } catch (_e) {
      setSkinError('刷新已购 Skill 包失败，请检查 skill_platform_next 目录是否存在且依赖已安装。')
    } finally {
      setSkinLoading(false)
    }
  }

  const counts = {
    to_install:     rows?.filter(r => r.status === 'to_install').length ?? 0,
    to_update:      rows?.filter(r => r.status === 'to_update').length ?? 0,
    already_latest: rows?.filter(r => r.status === 'already_latest').length ?? 0,
    to_disable:     rows?.filter(r => r.status === 'to_disable').length ?? 0,
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/* ── Purchased Skill packages ── */}
      <MgmtToolbar>
        <RefreshButton onClick={handleRefresh} disabled={skinLoading}>
          {skinLoading ? '正在加载...' : '刷新已购 Skill 包'}
        </RefreshButton>
        {skins !== null && (
          <SummaryBadge $color="#1a5fb4">已购 {skins.length} 个</SummaryBadge>
        )}
      </MgmtToolbar>
      {skinError && <MgmtErrorMsg>{skinError}</MgmtErrorMsg>}
      {skins !== null && (
        <SkinCardGrid>
          {skins.length === 0 && <MgmtEmptyState>暂无已购 Skill 包。</MgmtEmptyState>}
          {skins.map(skin => (
            <SkinCardRow key={skin.skill_id} skin={skin} />
          ))}
        </SkinCardGrid>
      )}

      {/* ── Sync-plan diagnostics (dev/debug only) ── */}
      <SectionDivider>同步计划诊断</SectionDivider>
      <div style={{ fontSize: 14, color: '#8a9ab0', marginBottom: 10, lineHeight: 1.6 }}>
        仅用于开发调试，显示平台包与本地安装状态差异，不代表已购买列表。
      </div>
      <MgmtToolbar>
        <CheckButton onClick={handleCheck} disabled={loading}>
          {loading ? '正在检查...' : '同步计划诊断'}
        </CheckButton>
        {rows !== null && totalEnt > 0 && <SummaryBadge $color="#1a5fb4">授权 {totalEnt}</SummaryBadge>}
        {rows !== null && counts.to_install > 0 && <SummaryBadge $color="#e67700">待安装 {counts.to_install}</SummaryBadge>}
        {rows !== null && counts.to_update > 0 && <SummaryBadge $color="#0066cc">待更新 {counts.to_update}</SummaryBadge>}
        {rows !== null && counts.already_latest > 0 && <SummaryBadge $color="#2e7d32">已最新 {counts.already_latest}</SummaryBadge>}
        {rows !== null && counts.to_disable > 0 && <SummaryBadge $color="#888">已禁用 {counts.to_disable}</SummaryBadge>}
      </MgmtToolbar>
      {error && <MgmtErrorMsg>{error}</MgmtErrorMsg>}
      {rows !== null && (
        <MgmtCardGrid>
          {rows.length === 0 && <MgmtEmptyState>暂无已购 Skill 记录。</MgmtEmptyState>}
          {rows.map(row => (
            <MgmtCard key={row.skill_id}>
              <MgmtCardLeft>
                <MgmtCardName>{row.display_name ?? row.skill_id}</MgmtCardName>
                <MgmtCardMeta>
                  <SkillId>{row.skill_id}</SkillId>
                  {row.package_id && <> &nbsp;包：<SkillId>{row.package_id}</SkillId></>}
                </MgmtCardMeta>
                <MgmtCardMeta>
                  {row.current_version && row.current_version !== row.target_version
                    ? <>版本：{row.current_version} → {row.target_version}</>
                    : <>版本：{row.target_version}</>
                  }
                </MgmtCardMeta>
                {row.description && <MgmtCardMeta>{row.description}</MgmtCardMeta>}
              </MgmtCardLeft>
              <MgmtCardRight>
                <PlanStatusBadge $status={row.status}>{skillPlanStatusLabel(row.status)}</PlanStatusBadge>
                <DisabledActionBtn disabled title="下一阶段支持">
                  {skillPlanActionLabel(row.status)}
                </DisabledActionBtn>
              </MgmtCardRight>
            </MgmtCard>
          ))}
        </MgmtCardGrid>
      )}
    </div>
  )
}

// ── Default export ─────────────────────────────────────────────────────────────

type StoreStatus = 'idle' | 'loading' | 'ready' | 'error'

export default function SkillManagementView() {
  const registeredSkills = listSkills()
  const [tab, setTab] = React.useState<'manage' | 'store'>('manage')
  const [storeStatus, setStoreStatus] = React.useState<StoreStatus>('idle')
  const [storeError, setStoreError] = React.useState<string | null>(null)
  const [embedUrl, setEmbedUrl] = React.useState<string | null>(null)

  async function handleOpenStore() {
    setTab('store')
    if (storeStatus === 'ready' && embedUrl) return
    setStoreStatus('loading')
    setStoreError(null)
    try {
      const result = await window.electronAPI.getSkillStoreEmbedUrl?.()
      if (!result || !result.ok) {
        setStoreStatus('error')
        setStoreError(result?.error ?? 'Skill Store 连接失败，请检查网络或服务器是否在线。')
        return
      }
      setEmbedUrl(result.url!)
      setStoreStatus('ready')
    } catch (e) {
      setStoreStatus('error')
      setStoreError(e instanceof Error ? e.message : '启动失败')
    }
  }

  return (
    <ViewWrapper>
      {/* ── Tab Bar ── */}
      <TabBar>
        <TabBtn $active={tab === 'manage'} onClick={() => setTab('manage')}>
          🧩 我的 Skill 包
        </TabBtn>
        <TabBtn
          $active={tab === 'store'}
          onClick={handleOpenStore}
          disabled={storeStatus === 'loading'}
        >
          🛒 Skill 商店
        </TabBtn>
        {storeStatus === 'loading' && <TabHint>正在启动 Skill Store 服务，请稍候...</TabHint>}
        {storeStatus === 'error' && storeError && (
          <TabErrHint title={storeError}>⚠ {storeError}</TabErrHint>
        )}
      </TabBar>

      {/* ── Tab Content ── */}
      <TabContent>
        {/* Manage tab */}
        <PageSlot $active={tab === 'manage'}>
          <ManageScrollArea>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f3142', margin: '0 0 4px' }}>Skill 中心</h1>
              <p style={{ fontSize: 14, color: '#627385', margin: '0 0 0' }}>
                管理已购买和授权的 AI Skill 包，或切换到"Skill 商店"标签浏览购买。
              </p>
            </div>

            <SkillManagementPanel />

            {registeredSkills.length > 0 && (
              <>
                <SectionDivider>本地已注册 Skill</SectionDivider>
                <SkillList>
                  {registeredSkills.map(skill => (
                    <SkillCard key={skill.manifest.id}>
                      <SkillName>{skill.manifest.name}</SkillName>
                      <SkillMeta>
                        类别：{skill.manifest.category}　版本：{skill.manifest.version}
                      </SkillMeta>
                      <SkillMeta>
                        <SkillId>{skill.manifest.id}</SkillId>
                      </SkillMeta>
                      {skill.manifest.description && (
                        <SkillMeta>{skill.manifest.description}</SkillMeta>
                      )}
                    </SkillCard>
                  ))}
                </SkillList>
              </>
            )}
          </ManageScrollArea>
        </PageSlot>

        {/* Store tab — keep iframe mounted once loaded to avoid page reload */}
        <PageSlot $active={tab === 'store'}>
          {storeStatus === 'loading' && (
            <StoreStateArea>
              <div>正在连接 Skill Store...</div>
            </StoreStateArea>
          )}
          {storeStatus === 'error' && (
            <StoreStateArea>
              <div style={{ color: '#c0392b', textAlign: 'center', maxWidth: 480 }}>⚠ {storeError}</div>
              <RetryBtn onClick={handleOpenStore}>重试</RetryBtn>
            </StoreStateArea>
          )}
          {storeStatus === 'idle' && (
            <StoreStateArea>
              <div style={{ color: '#8a9ab0' }}>点击"Skill 商店"标签载入商店</div>
            </StoreStateArea>
          )}
          {embedUrl && (
            <StoreFrame
              src={embedUrl}
              title="Skill 商店"
              style={{ display: storeStatus === 'ready' ? 'block' : 'none' }}
            />
          )}
        </PageSlot>
      </TabContent>
    </ViewWrapper>
  )
}
