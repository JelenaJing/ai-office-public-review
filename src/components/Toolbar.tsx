import React from 'react'
import { Editor } from '@tiptap/react'
import styled from 'styled-components'
import { DEFAULT_PAPER_TEMPLATE_ID, PAPER_TEMPLATES, type PaperTemplateId } from '../utils/paperTemplates'

const ToolbarContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 16px;
  background: #ffffff;
  border-bottom: 1px solid #dde3ec;
  flex-wrap: wrap;
  flex-shrink: 0;
`

const Divider = styled.div`
  width: 1px;
  height: 20px;
  background: #dde3ec;
  margin: 0 5px;
`

const ToolBtn = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border: none;
  border-radius: 3px;
  background: ${p => (p.$active ? '#eaf3ff' : 'transparent')};
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: ${p => (p.$active ? 600 : 400)};
  color: ${p => (p.$active ? '#0e639c' : '#304255')};
`

const FontSelect = styled.select`
  height: 26px;
  padding: 2px 6px;
  border: 1px solid #d6e0ea;
  border-radius: 3px;
  font-size: var(--font-size-xs);
  outline: none;
  background: #ffffff;
  color: #304255;
  cursor: pointer;
`

const ExportBtnGroup = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`

const ExportMainBtn = styled.button`
  height: 28px;
  padding: 0 8px 0 10px;
  border: 1px solid #2f62d8;
  border-right: 1px solid rgba(255,255,255,0.35);
  border-radius: 4px 0 0 4px;
  background: #2e68e6;
  color: #fff;
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #1a56d5; }
`

const ExportArrowBtn = styled.button`
  height: 28px;
  padding: 0 6px;
  border: 1px solid #2f62d8;
  border-left: none;
  border-radius: 0 4px 4px 0;
  background: #2e68e6;
  color: #fff;
  font-size: var(--font-size-xs);
  cursor: pointer;
  line-height: 1;
  &:hover { background: #1a56d5; }
`

const ExportMenu = styled.div<{ $open: boolean }>`
  display: ${p => (p.$open ? 'block' : 'none')};
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: #ffffff;
  border: 1px solid #d6e0ea;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  z-index: 200;
  min-width: 160px;
  padding: 4px 0;
`

const ExportMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  font-size: var(--font-size-sm);
  color: #304255;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  &:hover { background: #f0f4ff; color: #1a56d5; }
`

const MetaBtn = styled.button`
  height: 28px;
  padding: 0 10px;
  border: 1px solid #d6e0ea;
  border-radius: 4px;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`

const ImageToggleBtn = styled.button<{ $noImage: boolean }>`
  height: 28px;
  padding: 0 10px;
  border: 1px solid ${p => p.$noImage ? '#e0a800' : '#d6e0ea'};
  border-radius: 4px;
  background: ${p => p.$noImage ? '#fffbec' : '#ffffff'};
  color: ${p => p.$noImage ? '#916800' : '#304255'};
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  &:hover { opacity: 0.82; }
`

type ToolbarProps = {
  editor: Editor | null
  onSave?: () => void
  onExportPdf?: () => void
  onExportHtml?: () => void
  onExportWithJournalFormat?: () => void
  onSaveToKnowledge?: () => void
  onGeneratePptFromDocument?: () => void
  paperTemplateId?: PaperTemplateId
  onTemplateChange?: (templateId: PaperTemplateId) => void
  onPersistTemplate?: () => void
  onInsertInlineFormula?: () => void
  onInsertBlockFormula?: () => void
  onInsertLocalImage?: () => void
  previewMode?: 'edit' | 'preview'
  onPreviewModeChange?: (mode: 'edit' | 'preview') => void
  canPreviewFinal?: boolean
  canUsePreviewDocumentActions?: boolean
  previewDocumentActionBusy?: 'knowledge' | 'ppt' | null
  genNoImageMode?: boolean
  onToggleNoImageMode?: () => void
  isAidocFile?: boolean
}

const Toolbar: React.FC<ToolbarProps> = ({
  editor,
  onSave,
  onExportPdf,
  onExportHtml,
  onExportWithJournalFormat,
  onSaveToKnowledge,
  onGeneratePptFromDocument,
  paperTemplateId = DEFAULT_PAPER_TEMPLATE_ID,
  onTemplateChange,
  onPersistTemplate,
  onInsertInlineFormula,
  onInsertBlockFormula,
  onInsertLocalImage,
  previewMode = 'edit',
  onPreviewModeChange,
  canPreviewFinal = false,
  canUsePreviewDocumentActions = false,
  previewDocumentActionBusy = null,
  genNoImageMode = false,
  onToggleNoImageMode,
  isAidocFile = false,
}) => {
  if (!editor) return null
  const chain = () => (editor as any).chain().focus()
  const can = () => (editor as any).can()
  const setBlockStyle = (styles: Record<string, string | null>) => chain().setBlockStyle(styles, { all: true }).run()

  const [exportMenuOpen, setExportMenuOpen] = React.useState(false)
  const exportGroupRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!exportMenuOpen) return
    const handleOutsideClick = (e: MouseEvent) => {
      if (exportGroupRef.current && !exportGroupRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [exportMenuOpen])

  const previewToggle = onPreviewModeChange ? (
    <>
      <MetaBtn onClick={() => onPreviewModeChange('edit')} style={{ background: previewMode === 'edit' ? '#eaf3ff' : '#ffffff', borderColor: previewMode === 'edit' ? '#8fbef5' : '#d6e0ea', color: previewMode === 'edit' ? '#0e639c' : '#304255' }}>编辑</MetaBtn>
      <MetaBtn onClick={() => canPreviewFinal && onPreviewModeChange('preview')} disabled={!canPreviewFinal} title={canPreviewFinal ? '按当前 DOCX 文件的页边距、页眉页脚和分页结果只读预览' : '当前标签页没有可用于成文预览的 DOCX 文件'} style={{ background: previewMode === 'preview' ? '#eaf3ff' : '#ffffff', borderColor: previewMode === 'preview' ? '#8fbef5' : '#d6e0ea', color: previewMode === 'preview' ? '#0e639c' : '#304255', opacity: canPreviewFinal ? 1 : 0.55 }}>成文预览</MetaBtn>
      <Divider />
    </>
  ) : null

  const previewDocumentActions = canUsePreviewDocumentActions && (onSaveToKnowledge || onGeneratePptFromDocument) ? (
    <>
      <MetaBtn onClick={() => onSaveToKnowledge?.()} disabled={previewDocumentActionBusy !== null} data-testid="document-preview-save-knowledge-button">
        {previewDocumentActionBusy === 'knowledge' ? '正在存入…' : '存入知识库'}
      </MetaBtn>
      <MetaBtn onClick={() => onGeneratePptFromDocument?.()} disabled={previewDocumentActionBusy !== null} data-testid="document-preview-generate-ppt-button">
        {previewDocumentActionBusy === 'ppt' ? '正在跳转…' : '生成 PPT'}
      </MetaBtn>
      <Divider />
    </>
  ) : null

  return (
    <ToolbarContainer>
      <ExportBtnGroup ref={exportGroupRef}>
        <ExportMainBtn onClick={() => { onSave?.(); setExportMenuOpen(false) }}>
          {isAidocFile ? '💾 保存' : '导出'}
        </ExportMainBtn>
        <ExportArrowBtn onClick={() => setExportMenuOpen(v => !v)} title="选择导出格式">▾</ExportArrowBtn>
        <ExportMenu $open={exportMenuOpen}>
          {isAidocFile && (
            <ExportMenuItem onClick={() => { onSave?.(); setExportMenuOpen(false) }}>
              💾 保存 (.aidoc.json)
            </ExportMenuItem>
          )}
          <ExportMenuItem onClick={() => { onSave?.(); setExportMenuOpen(false) }}>
            📄 导出为 Word (.docx)
          </ExportMenuItem>
          <ExportMenuItem onClick={() => { onExportPdf?.(); setExportMenuOpen(false) }}>
            🖨 导出为 PDF
          </ExportMenuItem>
          <ExportMenuItem onClick={() => { onExportHtml?.(); setExportMenuOpen(false) }}>
            🌐 导出为 HTML
          </ExportMenuItem>
        </ExportMenu>
      </ExportBtnGroup>
      <MetaBtn onClick={() => onExportWithJournalFormat?.()}>期刊导出</MetaBtn>
      {previewMode === 'preview' ? null : (
        <ImageToggleBtn
          $noImage={genNoImageMode}
          onClick={() => onToggleNoImageMode?.()}
          title={genNoImageMode ? '当前：无图模式（点击开启图片生成）' : '当前：自动配图（点击关闭图片生成）'}
        >
          {genNoImageMode ? '🚫 图片生成' : '🖼 图片生成'}
        </ImageToggleBtn>
      )}
      <Divider />
      {previewToggle}
      {previewDocumentActions}
      {previewMode === 'preview' ? null : (
        <>
      <FontSelect value={paperTemplateId} onChange={(e) => onTemplateChange?.(e.target.value as PaperTemplateId)} title="论文模板">
        {Object.values(PAPER_TEMPLATES).map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
      </FontSelect>
      <MetaBtn onClick={() => onPersistTemplate?.()}>设为默认模板</MetaBtn>
      <Divider />
      <FontSelect defaultValue="2em" onChange={(e) => setBlockStyle({ textIndent: e.target.value })} title="首行缩进">
        <option value="2em">首行缩进 2 字</option>
        <option value="0">首行不缩进</option>
        <option value="1em">首行缩进 1 字</option>
        <option value="3em">首行缩进 3 字</option>
      </FontSelect>
      <FontSelect defaultValue="1.9" onChange={(e) => setBlockStyle({ lineHeight: e.target.value })} title="行距">
        <option value="1.6">行距 1.6</option>
        <option value="1.8">行距 1.8</option>
        <option value="1.9">行距 1.9</option>
        <option value="2">行距 2.0</option>
      </FontSelect>
      <FontSelect defaultValue="8px" onChange={(e) => setBlockStyle({ marginTop: e.target.value, marginBottom: e.target.value })} title="段间距">
        <option value="0">段距 0</option>
        <option value="6px">段距 6px</option>
        <option value="8px">段距 8px</option>
        <option value="12px">段距 12px</option>
      </FontSelect>
      <MetaBtn onClick={() => chain().clearBlockStyle({ all: true }).run()}>清除段落样式</MetaBtn>
      <Divider />
      <ToolBtn $active={editor.isActive('heading', { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()}>H1</ToolBtn>
      <ToolBtn $active={editor.isActive('heading', { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</ToolBtn>
      <ToolBtn $active={editor.isActive('heading', { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</ToolBtn>
      <Divider />
      <FontSelect onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())} title="字体">
        <option value="">默认字体</option>
        <option value="SimSun, serif">宋体</option>
        <option value="KaiTi, serif">楷体</option>
        <option value="SimHei, sans-serif">黑体</option>
        <option value="Microsoft YaHei, sans-serif">微软雅黑</option>
        <option value="FangSong, serif">仿宋</option>
        <option value='"Times New Roman", serif'>Times New Roman</option>
        <option value="Arial, sans-serif">Arial</option>
      </FontSelect>
      <FontSelect onChange={(e) => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())} title="字号">
        <option value="">字号</option>
        <option value="10pt">10pt</option>
        <option value="10.5pt">小五 (10.5pt)</option>
        <option value="11pt">11pt</option>
        <option value="12pt">小四 (12pt)</option>
        <option value="13pt">13pt</option>
        <option value="14pt">四号 (14pt)</option>
        <option value="15pt">15pt</option>
        <option value="16pt">三号 (16pt)</option>
        <option value="18pt">小二 (18pt)</option>
        <option value="22pt">二号 (22pt)</option>
        <option value="26pt">一号 (26pt)</option>
      </FontSelect>
      <Divider />
      <ToolBtn $active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><b>B</b></ToolBtn>
      <ToolBtn $active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><i>I</i></ToolBtn>
      <ToolBtn $active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}><u>U</u></ToolBtn>
      <ToolBtn $active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><s>S</s></ToolBtn>
      <ToolBtn $active={editor.isActive('highlight')} onClick={() => chain().toggleHighlight().run()}>🖍</ToolBtn>
      <ToolBtn $active={editor.isActive('superscript')} onClick={() => (editor as any).chain().focus().toggleSuperscript().run()} title="上标 (Ctrl+.)">X²</ToolBtn>
      <ToolBtn $active={editor.isActive('subscript')} onClick={() => (editor as any).chain().focus().toggleSubscript().run()} title="下标 (Ctrl+,)">X₂</ToolBtn>
      <Divider />
      <ToolBtn $active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>☰</ToolBtn>
      <ToolBtn $active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>1.</ToolBtn>
      <ToolBtn $active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()}>☑</ToolBtn>
      <Divider />
      <ToolBtn onClick={() => chain().setTextAlign('left').run()}>≡</ToolBtn>
      <ToolBtn onClick={() => chain().setTextAlign('center').run()}>≡</ToolBtn>
      <ToolBtn onClick={() => chain().setTextAlign('right').run()}>≡</ToolBtn>
      <Divider />
      <ToolBtn $active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>"</ToolBtn>
      <ToolBtn onClick={() => chain().setHorizontalRule().run()}>-</ToolBtn>
      <ToolBtn $active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()}>{'</>'}</ToolBtn>
      <Divider />
      <MetaBtn onClick={() => onInsertInlineFormula?.()}>行内公式</MetaBtn>
      <MetaBtn onClick={() => onInsertBlockFormula?.()}>块公式</MetaBtn>
      <MetaBtn onClick={() => onInsertLocalImage?.()}>插入图片</MetaBtn>
      <Divider />
      <ToolBtn onClick={() => chain().undo().run()} disabled={!can().undo()}>↩</ToolBtn>
      <ToolBtn onClick={() => chain().redo().run()} disabled={!can().redo()}>↪</ToolBtn>
        </>
      )}
    </ToolbarContainer>
  )
}

export default Toolbar