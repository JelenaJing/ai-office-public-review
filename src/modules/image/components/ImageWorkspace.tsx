import React, { useState } from 'react'
import styled from 'styled-components'
import { useDocument } from '../../../contexts/DocumentContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useDocumentEngineRuntime } from '../../../engines/documentEngine/runtime'
import { getPrimaryStyleReferenceId } from '../services/imageGenerationPrompt'
import {
  orderSelectedKnowledgeDocuments,
  resolveActiveImageStyleProfile,
  runSharedImageGeneration,
} from '../services/sharedImageGeneration'
import {
  normalizeFileLikePath as normalizeSharedFileLikePath,
  toDisplayUrl as toSharedDisplayUrl,
  toFileUrl,
} from '../../../shared/url/fileUrlHelper'
import { getBackendUrl } from '../../../config'
import { createPendingImageInsertionState } from '../../../utils/crossTabWriteback'

const Wrapper = styled.div`display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:12px 16px;`
const Title = styled.div`font-size:14px;font-weight:600;color:#444;margin-bottom:12px;`
const SectionTabs = styled.div`display:flex;gap:8px;margin-bottom:12px;`
const SectionTab = styled.button<{ $active?: boolean }>`border:1px solid ${p => p.$active ? '#2563eb' : '#cbd5e1'};border-radius:999px;background:${p => p.$active ? '#dbeafe' : '#fff'};color:${p => p.$active ? '#1d4ed8' : '#334155'};padding:6px 12px;font-size:var(--font-size-xs);font-weight:600;cursor:pointer;`
const Label = styled.label`font-size:var(--font-size-sm);color:#666;display:block;margin-bottom:4px;margin-top:10px;`
const TextArea = styled.textarea`width:100%;min-height:80px;border:1px solid #ddd;border-radius:6px;padding:10px;font-size:var(--font-size-sm);font-family:inherit;resize:vertical;outline:none;`
const Input = styled.input`width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:var(--font-size-sm);outline:none;background:#fff;`
const Select = styled.select`width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:var(--font-size-sm);outline:none;background:#fff;`
const Btn = styled.button<{ $primary?: boolean }>`width:100%;padding:10px 16px;margin-top:10px;border:${p => (p.$primary ? 'none' : '1px solid #ddd')};border-radius:6px;background:${p => (p.$primary ? '#0e639c' : '#fff')};color:${p => (p.$primary ? '#fff' : '#333')};font-size:var(--font-size-sm);font-weight:500;cursor:pointer;`
const Row = styled.div`display:flex;gap:8px;margin-top:8px;`
const PreviewBox = styled.div`margin-top:12px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fbff;text-align:center;padding:12px;img{max-width:100%;max-height:300px;border-radius:6px;box-shadow:0 8px 24px rgba(19,41,61,0.08);}`
const HistoryItem = styled.div`border:1px solid #eee;border-radius:6px;padding:8px;margin-top:8px;cursor:pointer;&:hover{background:#f7f7ff;} img{width:100%;max-height:120px;object-fit:contain;border-radius:4px;background:#f0f0f0;} .prompt{font-size:var(--font-size-xs);color:#888;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`
const FileBox = styled.div`border:1px dashed #cbd5e1;border-radius:8px;padding:10px 12px;background:#fff;color:#334155;font-size:var(--font-size-sm);word-break:break-all;`
const FieldGrid = styled.div`display:grid;gap:10px;margin-top:12px;grid-template-columns:repeat(2,minmax(0,1fr));`
const CheckboxRow = styled.label`display:flex;align-items:center;gap:8px;margin-top:10px;font-size:var(--font-size-xs);color:#475569;`
const ImageList = styled.div`display:grid;gap:8px;margin-top:12px;`
const ImageCard = styled.div<{ $selected?: boolean }>`border:1px solid ${p => p.$selected ? '#2563eb' : '#dbe3ef'};border-radius:8px;background:${p => p.$selected ? '#eff6ff' : '#fff'};padding:10px 12px;`
const ImageCardHeader = styled.div`display:flex;align-items:center;justify-content:space-between;gap:8px;`
const ImageThumb = styled.img`display:block;width:100%;max-height:120px;object-fit:contain;border-radius:6px;background:#f8fafc;margin-top:8px;`
const TinyBtn = styled.button`border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1f2937;font-size:var(--font-size-xs);padding:6px 10px;cursor:pointer;`
const EmptyHint = styled.div`padding:12px 0;font-size:var(--font-size-xs);color:#64748b;`
const ColorInput = styled.input`width:100%;height:38px;border:1px solid #ddd;border-radius:6px;padding:4px;background:#fff;`
const StatusBox = styled.div<{ $error?: boolean }>`margin-top:10px;padding:10px 12px;border-radius:8px;border:1px solid ${p => p.$error ? '#fecaca' : '#cbd5e1'};background:${p => p.$error ? '#fef2f2' : '#fff'};color:${p => p.$error ? '#991b1b' : '#334155'};font-size:var(--font-size-xs);line-height:1.7;`
const ReferenceStrip = styled.div`margin-top:12px;border:1px solid #dbe5ef;border-radius:10px;background:#f8fbff;padding:10px 12px;`
const ReferenceTitle = styled.div`font-size:var(--font-size-xs);font-weight:700;color:#1e3a5f;`
const ReferenceText = styled.div`margin-top:4px;font-size:var(--font-size-xs);line-height:1.6;color:#526579;`
const ReferenceGrid = styled.div`display:grid;gap:8px;margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));`
const ReferenceCard = styled.div`border:1px solid #dbe5ef;border-radius:8px;background:#fff;padding:8px;display:grid;gap:6px;`
const ReferenceThumb = styled.img`display:block;width:100%;height:88px;object-fit:cover;border-radius:6px;background:#eef3f8;`
const ReferenceName = styled.div`font-size:var(--font-size-xs);line-height:1.45;color:#334155;word-break:break-word;`

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 (宽屏)' },
  { value: '4:3', label: '4:3 (标准)' },
  { value: '1:1', label: '1:1 (正方形)' },
  { value: '3:4', label: '3:4 (竖图)' },
  { value: '9:16', label: '9:16 (手机竖屏)' },
]

const STITCH_LAYOUTS = [
  { value: 'vertical', label: '纵向拼接' },
  { value: 'horizontal', label: '横向拼接' },
  { value: 'grid', label: '网格拼接' },
]

interface FolderImageItem {
  name: string
  filePath: string
  previewUrl: string
  selected: boolean
}

function toDisplayUrl(rawPath: string): string {
  return toSharedDisplayUrl(rawPath, { backendUrl: getBackendUrl() })
}

function normalizeFileLikePath(rawPath: string): string {
  return normalizeSharedFileLikePath(rawPath)
}

function stripDataUrlPrefix(value: string): string {
  const match = String(value || '').match(/^data:[^;]+;base64,(.*)$/)
  return match ? match[1] : String(value || '')
}

function sanitizeFileName(value: string): string {
  return String(value || '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || `image_${Date.now()}`
}

function joinPath(basePath: string, relativePath: string): string {
  const base = String(basePath || '').replace(/[\\/]+$/, '')
  const relative = String(relativePath || '').replace(/^[\\/]+/, '')
  if (!base) return relative
  if (!relative) return base
  return `${base}/${relative}`
}

function fitImageSize(width: number, height: number, maxEdge = 1600): { width: number; height: number } {
  if (width <= maxEdge && height <= maxEdge) return { width, height }
  const scale = Math.min(maxEdge / width, maxEdge / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  await new Promise<void>((resolve, reject) => {
    const probe = new Image()
    probe.onload = () => resolve()
    probe.onerror = () => reject(new Error(`图片加载失败: ${url}`))
    probe.src = url
  })
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

const ImageWorkspace: React.FC<{ initialPrompt?: string }> = ({ initialPrompt }) => {
  const { activeTabId, setStatusMessage, markdown } = useDocument()
  const workbench = useGenerationWorkbench()
  const { info, documents, departmentId: knowledgeDepartmentId } = useKnowledge()
  const { activeWorkspacePath, refreshTree } = useWorkspace()
  const { runtime } = useDocumentEngineRuntime()
  const [activePanel, setActivePanel] = useState<'generate' | 'stitch'>('generate')
  const [prompt, setPrompt] = useState(initialPrompt || '')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewFilename, setPreviewFilename] = useState('')
  const [history, setHistory] = useState<Array<{ url: string; prompt: string; filename: string; timestamp: number }>>([])
  const [saving, setSaving] = useState(false)
  const [isProjectWs, setIsProjectWs] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  const [folderImages, setFolderImages] = useState<FolderImageItem[]>([])
  const [stitchLayout, setStitchLayout] = useState<'vertical' | 'horizontal' | 'grid'>('grid')
  const [stitchColumns, setStitchColumns] = useState(2)
  const [stitchGap, setStitchGap] = useState(12)
  const [stitchBackground, setStitchBackground] = useState('#ffffff')
  const [stitching, setStitching] = useState(false)
  const [stitchSaving, setStitchSaving] = useState(false)
  const [stitchPreviewUrl, setStitchPreviewUrl] = useState('')
  const [stitchFileName, setStitchFileName] = useState(`collage_${Date.now()}.png`)
  const [workspaceStatus, setWorkspaceStatus] = useState('')
  const imageSession = workbench.sessions.image
  const imageSessionDocumentIds = React.useMemo(
    () => imageSession.imageReferences.map((item) => item.id),
    [imageSession.imageReferences],
  )
  const imageSessionDocuments = React.useMemo(
    () => orderSelectedKnowledgeDocuments(documents, imageSessionDocumentIds, imageSession.primaryAssetId),
    [documents, imageSession.primaryAssetId, imageSessionDocumentIds],
  )
  const imageSessionPrimaryReferenceId = React.useMemo(
    () => getPrimaryStyleReferenceId(imageSession.imageReferences),
    [imageSession.imageReferences],
  )
  const imageSessionActiveStyleProfile = React.useMemo(
    () => resolveActiveImageStyleProfile(imageSession.lastImageStyleProfile, imageSessionPrimaryReferenceId),
    [imageSession.lastImageStyleProfile, imageSessionPrimaryReferenceId],
  )
  const effectivePreviewUrl = previewUrl || imageSession.resultPreviewUrl || ''
  const effectivePreviewFilename = previewFilename || imageSession.resultTitle || 'generated.png'
  const effectivePrompt = String(prompt || imageSession.generationPrompt || initialPrompt || '').trim()

  const freezeInsertTarget = React.useCallback(() => {
    const runtimeSelection = runtime?.getSelection() || null
    const targetSelection = runtimeSelection
      ? {
          from: runtimeSelection.from,
          to: runtimeSelection.to,
          anchorId: runtimeSelection.anchorId,
          text: String(runtimeSelection.text || '').trim(),
        }
      : imageSession.targetSelection
    const targetTabId = imageSession.targetTabId || activeTabId || null
    const now = new Date().toISOString()

    workbench.setModeSession('image', (session) => ({
      ...session,
      sourceTabId: targetTabId,
      targetTabId,
      targetSelection,
      lastUpdatedAt: now,
    }))

    return { targetTabId, targetSelection }
  }, [activeTabId, imageSession.targetSelection, imageSession.targetTabId, runtime, workbench])

  const queuePendingImageInsertion = React.useCallback((payload: {
    src: string
    alt?: string
    title?: string
    placement: 'cursor' | 'after-selection' | 'document-end'
    selection: { from: number; to: number; anchorId?: string; text?: string } | null
    statusMessage: string
  }) => {
    const { targetTabId, targetSelection } = freezeInsertTarget()
    if (!targetTabId) {
      setStatusMessage('当前没有可回写的文稿标签，图片已保留在图片工作区')
      return false
    }

    const now = new Date().toISOString()
    workbench.setModeSession('image', (session) => ({
      ...session,
      sourceTabId: targetTabId,
      targetTabId,
      targetSelection: payload.selection || targetSelection,
      pendingImageInsertion: createPendingImageInsertionState({
        tabId: targetTabId,
        src: payload.src,
        alt: payload.alt,
        title: payload.title,
        placement: payload.placement,
        selection: payload.selection || targetSelection,
        statusMessage: payload.statusMessage,
        createdAt: now,
      }),
      lastUpdatedAt: now,
    }))
    setStatusMessage(payload.statusMessage)
    return true
  }, [freezeInsertTarget, setStatusMessage, workbench])

  React.useEffect(() => {
    if (!activeWorkspacePath) { setIsProjectWs(false); return }
    window.electronAPI.detectProjectStructure(activeWorkspacePath).then((s) => setIsProjectWs(!!s.hasFigures)).catch(() => setIsProjectWs(false))
  }, [activeWorkspacePath])

  const visibleStyleDocuments = React.useMemo(
    () => imageSessionDocuments.slice(0, 4),
    [imageSessionDocuments],
  )

  const handleGenerate = async () => {
    const normalizedPrompt = String(prompt || imageSession.generationPrompt || initialPrompt || '').trim()
    if (!normalizedPrompt) return
    freezeInsertTarget()

    setGenerating(true)
    setPreviewUrl('')
    workbench.setModeSession('image', (session) => ({
      ...session,
      generationPrompt: normalizedPrompt,
      generationStatus: {
        phase: 'running',
        message: imageSession.imageReferences.length > 0 ? `正在准备并上传 ${imageSession.imageReferences.length} 张参考图...` : '正在生成图片，请稍候...',
        updatedAt: new Date().toISOString(),
      },
      lastImageStyleProfile: null,
      resultAssetId: null,
      resultType: null,
      resultPath: null,
      resultTitle: '',
      resultPreviewText: '',
      resultPreviewUrl: null,
      lastUpdatedAt: new Date().toISOString(),
    }))

    try {
      /* ── gather document context & KB text context ── */
      const docPlain = String(markdown || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const documentContext = docPlain.slice(0, 500) || undefined
      let knowledgeTextContext: string | undefined
      if (knowledgeDepartmentId) {
        try {
          const preview = await window.electronAPI.previewKnowledgeTaskContext(knowledgeDepartmentId, { instruction: normalizedPrompt, topK: 3 })
          const hits = (preview?.retrievedHits || []).map((h: any) => String(h?.chunk?.text || h?.quote || '').trim()).filter(Boolean)
          if (hits.length > 0) knowledgeTextContext = hits.join('\n---\n')
        } catch { /* KB unavailable */ }
      }

      const { result, references, roleSummary } = await runSharedImageGeneration({
        prompt: normalizedPrompt,
        knowledgeRootPath: info?.rootPath,
        documents: imageSessionDocuments,
        imageReferences: imageSession.imageReferences,
        styleOptions: imageSession.imageStyleOptions,
        generationMode: imageSession.imageGenerationMode,
        activeStyleProfile: imageSessionActiveStyleProfile,
        aspectRatio,
        source: 'ImageWorkspace.handleGenerate',
        knowledgeTextContext,
        documentContext,
        debugContext: {
          note: 'Image workspace now delegates to shared image pipeline instead of keeping a parallel request shape',
        },
        onStatus: (message) => {
          setStatusMessage(message)
          workbench.setModeSession('image', (session) => ({
            ...session,
            generationStatus: {
              phase: 'running',
              message,
              updatedAt: new Date().toISOString(),
            },
            lastUpdatedAt: new Date().toISOString(),
          }))
        },
        onStyleProfileChange: (profile) => {
          workbench.setModeSession('image', (session) => ({
            ...session,
            lastImageStyleProfile: profile,
            lastUpdatedAt: new Date().toISOString(),
          }))
        },
      })

      if (result.status === 'success' && result.image_url) {
        const fullUrl = toDisplayUrl(result.image_url)
        const outputPath = result.file_path || result.image_url
        const resultTitle = result.filename || 'generated.png'
        setPreviewUrl(fullUrl)
        setPreviewFilename(resultTitle)
        setHistory((prev) => [{ url: fullUrl, prompt: normalizedPrompt, filename: resultTitle, timestamp: Date.now() }, ...prev].slice(0, 20))
        workbench.setModeSession('image', (session) => ({
          ...session,
          generationPrompt: normalizedPrompt,
          generationStatus: {
            phase: 'completed',
            message: '图片已生成，可在图片工作台继续保存或插入编辑器。',
            updatedAt: new Date().toISOString(),
          },
          resultType: 'image',
          resultAssetId: outputPath || null,
          resultPath: outputPath || null,
          resultTitle,
          resultPreviewUrl: fullUrl,
          lastUpdatedAt: new Date().toISOString(),
        }))
        setStatusMessage(references.length > 0 ? `图片生成完成，参考链路：${roleSummary.join(' / ')}` : '图片生成完成')
      } else {
        const errorMessage = result.error || '图片生成失败'
        workbench.setModeSession('image', (session) => ({
          ...session,
          generationStatus: {
            phase: 'error',
            message: errorMessage,
            updatedAt: new Date().toISOString(),
          },
          lastUpdatedAt: new Date().toISOString(),
        }))
        setStatusMessage(`图片生成失败: ${errorMessage}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      workbench.setModeSession('image', (session) => ({
        ...session,
        generationStatus: {
          phase: 'error',
          message,
          updatedAt: new Date().toISOString(),
        },
        lastUpdatedAt: new Date().toISOString(),
      }))
      setStatusMessage(message)
    } finally {
      setGenerating(false)
    }
  }

  const handleSaveToWorkspace = async () => {
    if (!effectivePreviewUrl || !activeWorkspacePath) return
    setSaving(true)
    try {
      const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
      const result = structure.hasFigures
        ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, normalizeFileLikePath(effectivePreviewUrl), effectivePreviewFilename)
        : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, normalizeFileLikePath(effectivePreviewUrl), effectivePreviewFilename)
      if (result.success) {
        setStatusMessage(`图片已保存: ${result.filename}`)
        refreshTree()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleInsertToEditor = async () => {
    if (!effectivePreviewUrl) return
    if (!activeWorkspacePath) {
      setStatusMessage('请先打开工作区，图片会先保存到工作区后再插入编辑器')
      return
    }
    try {
      const { targetTabId, targetSelection } = freezeInsertTarget()
      const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
      const sourcePath = normalizeFileLikePath(effectivePreviewUrl)
      const saved = structure.hasFigures
        ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, sourcePath, effectivePreviewFilename)
        : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, sourcePath, effectivePreviewFilename)
      const savedImageUrl = toFileUrl(saved.path)
      setPreviewUrl(savedImageUrl)
      const imageAlt = effectivePrompt.slice(0, 30) || effectivePreviewFilename
      const imagePlacement = targetSelection && targetSelection.from !== targetSelection.to ? 'after-selection' : 'cursor'
      if (runtime && targetTabId && activeTabId === targetTabId) {
        await runtime.insertAnchoredImage({ src: savedImageUrl, alt: imageAlt, title: imageAlt, placement: imagePlacement })
        setStatusMessage('图片已保存到工作区并插入编辑器')
      } else {
        queuePendingImageInsertion({
          src: savedImageUrl,
          alt: imageAlt,
          title: imageAlt,
          placement: imagePlacement,
          selection: targetSelection,
          statusMessage: '图片已保存到工作区，回到原文稿标签后会自动插入',
        })
      }
      refreshTree()
    } catch (error) {
      setStatusMessage(error instanceof Error ? `图片保存失败，未插入编辑器: ${error.message}` : '图片保存失败，未插入编辑器')
    }
  }

  const handlePickFolder = async () => {
    const dirPath = await window.electronAPI.openDirectoryDialog()
    if (!dirPath) return
    const images = await window.electronAPI.listDirectoryImages(dirPath)
    const nextImages = images.map((item) => ({
      name: item.name,
      filePath: item.filePath,
      previewUrl: toDisplayUrl(item.filePath),
      selected: true,
    }))
    setFolderPath(dirPath)
    setFolderImages(nextImages)
    setStitchPreviewUrl('')
    setStitchFileName(`${sanitizeFileName(dirPath.split(/[\\/]/).pop() || 'collage')}_${Date.now()}.png`)
    setWorkspaceStatus(nextImages.length > 0 ? `已加载 ${nextImages.length} 张图片` : '该文件夹中没有可拼接的图片')
    setStatusMessage(nextImages.length > 0 ? `已加载 ${nextImages.length} 张图片` : '该文件夹中没有可拼接的图片')
  }

  const toggleFolderImage = (filePath: string) => {
    setFolderImages((prev) => prev.map((item) => item.filePath === filePath ? { ...item, selected: !item.selected } : item))
  }

  const moveFolderImage = (filePath: string, direction: -1 | 1) => {
    setFolderImages((prev) => {
      const index = prev.findIndex((item) => item.filePath === filePath)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      const [current] = next.splice(index, 1)
      next.splice(targetIndex, 0, current)
      return next
    })
  }

  const selectedFolderImages = folderImages.filter((item) => item.selected)

  const buildCollage = async () => {
    if (selectedFolderImages.length === 0) {
      setWorkspaceStatus('请至少选择一张图片后再拼接')
      return
    }

    setStitching(true)
    setWorkspaceStatus('正在拼接图片...')
    setStatusMessage('正在拼接图片...')
    try {
      const loaded = await Promise.all(selectedFolderImages.map(async (item) => {
        const image = await loadImage(item.previewUrl)
        const fitted = fitImageSize(image.naturalWidth || image.width, image.naturalHeight || image.height)
        return { ...item, image, width: fitted.width, height: fitted.height }
      }))

      const gap = Math.max(0, stitchGap)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前环境无法创建图片画布')

      if (stitchLayout === 'vertical') {
        canvas.width = Math.max(...loaded.map((item) => item.width))
        canvas.height = loaded.reduce((sum, item, index) => sum + item.height + (index > 0 ? gap : 0), 0)
        let offsetY = 0
        ctx.fillStyle = stitchBackground
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        for (const item of loaded) {
          const offsetX = Math.round((canvas.width - item.width) / 2)
          ctx.drawImage(item.image, offsetX, offsetY, item.width, item.height)
          offsetY += item.height + gap
        }
      } else if (stitchLayout === 'horizontal') {
        canvas.width = loaded.reduce((sum, item, index) => sum + item.width + (index > 0 ? gap : 0), 0)
        canvas.height = Math.max(...loaded.map((item) => item.height))
        let offsetX = 0
        ctx.fillStyle = stitchBackground
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        for (const item of loaded) {
          const offsetY = Math.round((canvas.height - item.height) / 2)
          ctx.drawImage(item.image, offsetX, offsetY, item.width, item.height)
          offsetX += item.width + gap
        }
      } else {
        const columns = Math.max(1, stitchColumns)
        const rows = Math.ceil(loaded.length / columns)
        const cellWidth = Math.max(...loaded.map((item) => item.width))
        const cellHeight = Math.max(...loaded.map((item) => item.height))
        canvas.width = columns * cellWidth + Math.max(0, columns - 1) * gap
        canvas.height = rows * cellHeight + Math.max(0, rows - 1) * gap
        ctx.fillStyle = stitchBackground
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        loaded.forEach((item, index) => {
          const row = Math.floor(index / columns)
          const column = index % columns
          const baseX = column * (cellWidth + gap)
          const baseY = row * (cellHeight + gap)
          const offsetX = baseX + Math.round((cellWidth - item.width) / 2)
          const offsetY = baseY + Math.round((cellHeight - item.height) / 2)
          ctx.drawImage(item.image, offsetX, offsetY, item.width, item.height)
        })
      }

      const dataUrl = canvas.toDataURL('image/png')
      setStitchPreviewUrl(dataUrl)
      setWorkspaceStatus(`拼接完成，共合成 ${selectedFolderImages.length} 张图片`)
      setStatusMessage(`拼接完成，共合成 ${selectedFolderImages.length} 张图片`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setWorkspaceStatus(message)
      setStatusMessage(message)
    } finally {
      setStitching(false)
    }
  }

  const saveStitchedImage = async (insertToEditor = false) => {
    if (!stitchPreviewUrl || !activeWorkspacePath) return
    const filename = stitchFileName.trim() || `collage_${Date.now()}.png`
    setStitchSaving(true)
    try {
      const { targetTabId, targetSelection } = insertToEditor ? freezeInsertTarget() : { targetTabId: null, targetSelection: null }
      const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
      const result = structure.hasFigures
        ? await window.electronAPI.saveImageToFiguresBase64(activeWorkspacePath, filename, stripDataUrlPrefix(stitchPreviewUrl))
        : await window.electronAPI.saveImageToWorkspace(activeWorkspacePath, filename, stripDataUrlPrefix(stitchPreviewUrl))
      refreshTree()
      if (insertToEditor && runtime && targetTabId && activeTabId === targetTabId) {
        const imagePlacement = targetSelection && targetSelection.from !== targetSelection.to ? 'after-selection' : 'cursor'
        await runtime.insertAnchoredImage({ src: toFileUrl(result.path), alt: filename, title: filename, placement: imagePlacement })
        setStatusMessage('拼接图已保存到工作区并插入编辑器')
      } else if (insertToEditor) {
        queuePendingImageInsertion({
          src: toFileUrl(result.path),
          alt: filename,
          title: filename,
          placement: targetSelection && targetSelection.from !== targetSelection.to ? 'after-selection' : 'cursor',
          selection: targetSelection,
          statusMessage: '拼接图已保存到工作区，回到原文稿标签后会自动插入',
        })
      } else {
        setStatusMessage(`拼接图已保存: ${result.filename}`)
      }
    } finally {
      setStitchSaving(false)
    }
  }

  return (
    <Wrapper>
      <Title>🎨 图片工作区</Title>
      <SectionTabs>
        <SectionTab $active={activePanel === 'generate'} onClick={() => setActivePanel('generate')}>生成图片</SectionTab>
        <SectionTab $active={activePanel === 'stitch'} onClick={() => setActivePanel('stitch')}>拼接图片</SectionTab>
      </SectionTabs>

      {activePanel === 'generate' ? (
        <>
          <Label>图片描述（Prompt）*</Label>
          <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={generating} />
          <ReferenceStrip>
            <ReferenceTitle>知识库风格参考图</ReferenceTitle>
            <ReferenceText>
              {imageSessionDocuments.length > 0
                ? `当前已从知识库勾选 ${imageSessionDocuments.length} 张风格图。生成时会自动带入前 ${visibleStyleDocuments.length} 张，尽量保持同系列画风。`
                : '在知识库里把图片勾选为“风格参考”后，这里会自动带入到本次生图请求。'}
            </ReferenceText>
            {visibleStyleDocuments.length > 0 ? (
              <ReferenceGrid>
                {visibleStyleDocuments.map((item) => {
                  const previewPath = joinPath(info?.rootPath || '', item.storedRelativePath)
                  return (
                    <ReferenceCard key={item.id}>
                      <ReferenceThumb src={toDisplayUrl(previewPath)} alt={item.title} />
                      <ReferenceName>{item.title}</ReferenceName>
                    </ReferenceCard>
                  )
                })}
              </ReferenceGrid>
            ) : null}
          </ReferenceStrip>
          <Label>画面比例</Label>
          <Select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={generating}>
            {ASPECT_RATIOS.map((ratio) => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}
          </Select>
          <Btn $primary onClick={handleGenerate} disabled={!effectivePrompt || generating}>{generating ? '⏳ 生成中...' : '🎨 生成图片'}</Btn>
          {effectivePreviewUrl && (
            <>
              <PreviewBox><img src={effectivePreviewUrl} alt="generated" /></PreviewBox>
              <Row>
                <Btn onClick={handleInsertToEditor}>📝 插入编辑器</Btn>
                <Btn $primary onClick={handleSaveToWorkspace} disabled={saving || !activeWorkspacePath}>{saving ? '保存中...' : isProjectWs ? '💾 保存到 Final_Figures/' : '💾 保存到 pic/'}</Btn>
              </Row>
            </>
          )}
          {history.length > 0 && (
            <>
              <Label style={{ marginTop: 16 }}>生成历史</Label>
              {history.map((img, index) => <HistoryItem key={index} onClick={() => { setPreviewUrl(img.url); setPreviewFilename(img.filename) }}><img src={img.url} alt={img.prompt.slice(0, 20)} /><div className="prompt">{img.prompt}</div></HistoryItem>)}
            </>
          )}
        </>
      ) : (
        <>
          <Label>图片文件夹</Label>
          <FileBox>{folderPath || '请选择包含图片的文件夹'}</FileBox>
          <Btn onClick={() => void handlePickFolder()}>📂 选择图片文件夹</Btn>

          <FieldGrid>
            <div>
              <Label>拼接方式</Label>
              <Select value={stitchLayout} onChange={(e) => setStitchLayout(e.target.value as 'vertical' | 'horizontal' | 'grid')}>
                {STITCH_LAYOUTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
            </div>
            <div>
              <Label>背景颜色</Label>
              <ColorInput type="color" value={stitchBackground} onChange={(e) => setStitchBackground(e.target.value)} />
            </div>
            <div>
              <Label>图片间距</Label>
              <Input type="number" min={0} value={stitchGap} onChange={(e) => setStitchGap(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>网格列数</Label>
              <Input type="number" min={1} value={stitchColumns} onChange={(e) => setStitchColumns(Math.max(1, Number(e.target.value) || 1))} disabled={stitchLayout !== 'grid'} />
            </div>
          </FieldGrid>

          <Label>输出文件名</Label>
          <Input value={stitchFileName} onChange={(e) => setStitchFileName(e.target.value)} />

          <CheckboxRow>
            <input
              type="checkbox"
              checked={selectedFolderImages.length > 0 && selectedFolderImages.length === folderImages.length}
              onChange={(e) => setFolderImages((prev) => prev.map((item) => ({ ...item, selected: e.target.checked })))}
            />
            全选当前文件夹图片
          </CheckboxRow>

          <ImageList>
            {folderImages.length === 0 && <EmptyHint>选中文件夹后，这里会列出可参与拼接的图片。</EmptyHint>}
            {folderImages.map((item, index) => (
              <ImageCard key={item.filePath} $selected={item.selected}>
                <ImageCardHeader>
                  <CheckboxRow style={{ marginTop: 0 }}>
                    <input type="checkbox" checked={item.selected} onChange={() => toggleFolderImage(item.filePath)} />
                    <span>{index + 1}. {item.name}</span>
                  </CheckboxRow>
                  <Row style={{ marginTop: 0 }}>
                    <TinyBtn onClick={() => moveFolderImage(item.filePath, -1)}>上移</TinyBtn>
                    <TinyBtn onClick={() => moveFolderImage(item.filePath, 1)}>下移</TinyBtn>
                  </Row>
                </ImageCardHeader>
                <ImageThumb src={item.previewUrl} alt={item.name} />
              </ImageCard>
            ))}
          </ImageList>

          <Btn $primary onClick={() => void buildCollage()} disabled={stitching || selectedFolderImages.length === 0}>{stitching ? '⏳ 拼接中...' : `🧩 开始拼接 (${selectedFolderImages.length})`}</Btn>

          {workspaceStatus && <StatusBox $error={/失败|错误|无法/.test(workspaceStatus)}>{workspaceStatus}</StatusBox>}

          {stitchPreviewUrl && (
            <>
              <PreviewBox><img src={stitchPreviewUrl} alt="stitched" /></PreviewBox>
              <Row>
                <Btn onClick={() => void saveStitchedImage(true)} disabled={stitchSaving || !activeWorkspacePath || !runtime}>📝 保存并插入</Btn>
                <Btn $primary onClick={() => void saveStitchedImage(false)} disabled={stitchSaving || !activeWorkspacePath}>{stitchSaving ? '保存中...' : isProjectWs ? '💾 保存到 Final_Figures/' : '💾 保存到 pic/'}</Btn>
              </Row>
            </>
          )}
        </>
      )}
    </Wrapper>
  )
}

export default ImageWorkspace