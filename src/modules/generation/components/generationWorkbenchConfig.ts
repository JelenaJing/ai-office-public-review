import type { GenerationMode } from '../../../contexts/WorkspaceModeContext'
import type { KnowledgeDocumentMeta } from '../../../types/knowledge'

export interface GenerationModeOption {
  value: GenerationMode
  label: string
  description: string
  composerPlaceholder: string
  knowledgeHint: string
  previewHint: string
}

export const GENERATION_MODE_OPTIONS: GenerationModeOption[] = [
  {
    value: 'document',
    label: '文稿',
    description: '基于模板生成可直接检查和导出的正式文稿。',
    composerPlaceholder: '请输入文稿生成需求，例如：以当前模板生成一份给杭州市政府的贺信，时间写 2026 年 4 月。',
    knowledgeHint: '支持 DOCX / DOC 作为模板，PDF / Markdown / TXT 作为参考资料。',
    previewHint: '右侧展示文稿预览，并提供打开、下载和定位输出目录。',
  },
  {
    value: 'image',
    label: '图片',
    description: '根据参考图和描述生成图片，支持风格锁定。',
    composerPlaceholder: '请输入图片生成需求，例如：做一张蓝白学术风格的 AI 产业趋势信息图。',
    knowledgeHint: '支持 JPG / PNG / WEBP 作为参考图，可分别设为主参考、风格参考或内容参考。',
    previewHint: '右侧展示图片结果，可保存或直接打开。',
  },
  {
    value: 'ppt',
    label: 'PPT',
    description: '基于资料生成 PPT 演示文稿。',
    composerPlaceholder: '请输入 PPT 生成需求，例如：生成一份 8 页以内的管理层汇报 PPT。',
    knowledgeHint: '支持 PDF / DOCX / Markdown / 图片作为演示素材。',
    previewHint: '右侧展示 PPT 页结构预览，可下载或打开。',
  },
  {
    value: 'email',
    label: '邮件',
    description: 'AI 生成邮件草稿，支持发送与收件演示。',
    composerPlaceholder: '请输入邮件需求，例如：写一封项目延期通知邮件给客户...',
    knowledgeHint: '邮件模式为本地演示系统。',
    previewHint: '右侧展示邮件详情与发送操作。',
  },
  {
    value: 'homework',
    label: '作业解答',
    description: '上传作业 PDF 或 DOCX，AI 逐题提取并解答。',
    composerPlaceholder: '上传作业文件开始解答...',
    knowledgeHint: '作业解答模式自动提取题目，无需手动上传资料。',
    previewHint: '逐题展示题目与 AI 解答，支持导出。',
  },
  {
    value: 'ai-class',
    label: 'AI课堂',
    description: '连接远程 AI 课堂平台，访问课程内容、互动问答与实验环境。',
    composerPlaceholder: '在 AI 课堂中学习...',
    knowledgeHint: 'AI 课堂模式直接连接远程学习平台。',
    previewHint: '嵌入式访问远程 AI 课堂系统。',
  },
  {
    value: 'ai-forum',
    label: 'AI论坛',
    description: '嵌入访问 AI 论坛，浏览社区讨论与学习资源。',
    composerPlaceholder: '在 AI 论坛中浏览...',
    knowledgeHint: 'AI 论坛模式直接嵌入远程论坛页面。',
    previewHint: '嵌入式访问 AI 论坛社区。',
  },
]

export function getGenerationModeOption(mode: GenerationMode): GenerationModeOption {
  return GENERATION_MODE_OPTIONS.find((item) => item.value === mode) || GENERATION_MODE_OPTIONS[0]
}

export function isDocumentTemplateCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.sourceType === 'doc' || document.sourceType === 'docx'
}

export function isDocumentMaterialCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.sourceType === 'pdf'
    || document.sourceType === 'docx'
    || document.sourceType === 'doc'
    || document.sourceType === 'pptx'
    || document.sourceType === 'md'
    || document.sourceType === 'txt'
}

export function isImageMaterialCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.sourceType === 'image'
}

export function isPptMaterialCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.sourceType === 'pdf'
    || document.sourceType === 'docx'
    || document.sourceType === 'doc'
    || document.sourceType === 'pptx'
    || document.sourceType === 'md'
    || document.sourceType === 'txt'
    || document.sourceType === 'image'
}

export function isEmailMaterialCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.templateType === 'email_reply'
    || document.sourceType === 'pdf'
    || document.sourceType === 'docx'
    || document.sourceType === 'doc'
    || document.sourceType === 'md'
    || document.sourceType === 'txt'
}

export function isEmailTemplateCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.templateType === 'email_reply'
}

export function matchesGenerationCandidate(mode: GenerationMode, document: KnowledgeDocumentMeta): boolean {
  if (mode === 'document') return isDocumentTemplateCandidate(document) || isDocumentMaterialCandidate(document)
  if (mode === 'image') return isImageMaterialCandidate(document)
  if (mode === 'email') return isEmailMaterialCandidate(document)
  if (mode === 'daily-report') return false
  return isPptMaterialCandidate(document)
}

export function getGenerationResultLabel(resultType: 'docx' | 'image' | 'ppt-outline' | 'pptx' | null): string {
  if (resultType === 'docx') return '文稿结果'
  if (resultType === 'image') return '图片结果'
  if (resultType === 'ppt-outline') return 'PPT 计划'
  if (resultType === 'pptx') return 'PPT 文件'
  return '暂无结果'
}