/**
 * WorkReportPanel — 工作日报入口（管理层专用）
 *
 * 复用 AdminActivityPanel 的核心功能，UI 名称改为"工作日报"。
 * 入口显示条件：拥有 work_report.view_* 权限或管理员角色。
 * 普通员工不显示此入口。
 */

import { AdminActivityPanel } from './AdminActivityPanel'

interface WorkReportPanelProps {
  onClose: () => void
}

export default function WorkReportPanel({ onClose }: WorkReportPanelProps) {
  return <AdminActivityPanel onClose={onClose} title="📊 工作日报" />
}
