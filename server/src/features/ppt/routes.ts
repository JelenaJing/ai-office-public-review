import { Router, type Request } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createMinimaxPptxTask,
  getMinimaxPptxTask,
  updateMinimaxPptxTask,
} from './services/minimaxPptxTaskStore'
import { generateMinimaxPptx } from './services/minimaxPptxGenerator'
import { generatePptPreviewImages } from './services/pptPreviewService'
import {
  getPptPreviewImagePath,
  getPptSession,
  sanitizePathSegment,
  updatePptSession,
} from './services/pptSessionStore'

const router = Router()

function getRequestUserId(req: Request): string {
  const header = req.headers['x-user-id']
  const raw = Array.isArray(header) ? header[0] : header
  return sanitizePathSegment(raw || 'web-user', 'web-user')
}

function createTaskId(): string {
  return sanitizePathSegment(`ppt-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 'ppt-task')
}

function sessionPayload(session: Awaited<ReturnType<typeof getPptSession>>) {
  if (!session) return null
  return {
    id: session.id,
    title: session.title,
    slideCount: session.slideCount,
    previewImages: session.previewImages,
    previewStatus: session.previewStatus ?? 'pending',
    previewMessage: session.previewMessage,
    downloadUrl: `/api/ppt/sessions/${encodeURIComponent(session.id)}/download`,
  }
}

router.post('/decks/start', async (req, res) => {
  const body = req.body as {
    workspacePath?: string
    prompt?: string
    title?: string
    mode?: 'minimax_direct'
  }
  const prompt = String(body.prompt || '').trim()

  if (!prompt) {
    res.status(400).json({ success: false, message: '请先输入 PPT 主题或需求。' })
    return
  }

  const mode = body.mode ?? 'minimax_direct'
  if (mode !== 'minimax_direct') {
    res.status(400).json({ success: false, message: `不支持的 PPT 生成模式：${mode}` })
    return
  }

  const userId = getRequestUserId(req)
  const taskId = createTaskId()
  createMinimaxPptxTask(taskId, 'MiniMax PPTX 任务已创建')
  updateMinimaxPptxTask(taskId, {
    status: 'running',
    progress: 5,
    message: 'MiniMax Direct PPTX 任务启动中',
  })

  void (async () => {
    try {
      const generated = await generateMinimaxPptx({
        taskId,
        userId,
        prompt,
        title: body.title,
        onProgress: (progress, message) => {
          updateMinimaxPptxTask(taskId, {
            status: 'running',
            progress,
            message,
          })
        },
      })

      updateMinimaxPptxTask(taskId, {
        status: 'running',
        progress: 92,
        message: 'PPTX 已生成，正在创建预览图',
        sessionId: generated.sessionId,
      })

      const preview = await generatePptPreviewImages({
        userId,
        sessionId: generated.sessionId,
        pptxPath: generated.pptxPath,
      })

      await updatePptSession(generated.sessionId, {
        previewImages: preview.previewImages,
        previewStatus: preview.previewStatus,
        previewMessage: preview.message,
      })

      updateMinimaxPptxTask(taskId, {
        status: 'completed',
        progress: 100,
        message: preview.previewStatus === 'ready'
          ? 'PPTX 已生成，预览图已就绪'
          : 'PPTX 已生成，可下载；当前服务器未安装预览组件。',
        sessionId: generated.sessionId,
        result: {
          sessionId: generated.sessionId,
          pptxPath: generated.pptxPath,
          slideCount: generated.slideCount,
          previewImages: preview.previewImages,
          previewStatus: preview.previewStatus,
          downloadUrl: `/api/ppt/sessions/${encodeURIComponent(generated.sessionId)}/download`,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateMinimaxPptxTask(taskId, {
        status: 'failed',
        progress: 100,
        message: 'MiniMax PPTX 生成失败',
        error: message,
      })
    }
  })()

  res.json({
    success: true,
    taskId,
    status: 'running',
  })
})

router.get('/tasks/:taskId', (req, res) => {
  const task = getMinimaxPptxTask(req.params.taskId)
  if (!task) {
    res.status(404).json({ success: false, message: '任务不存在或已过期。' })
    return
  }

  res.json({ success: true, task })
})

router.get('/sessions/:sessionId', async (req, res) => {
  const session = await getPptSession(req.params.sessionId)
  const payload = sessionPayload(session)
  if (!payload) {
    res.status(404).json({ success: false, message: 'PPT 会话不存在。' })
    return
  }

  res.json({ success: true, session: payload })
})

router.get('/sessions/:sessionId/slides/:page', async (req, res) => {
  const session = await getPptSession(req.params.sessionId)
  if (!session) {
    res.status(404).json({ success: false, message: 'PPT 会话不存在。' })
    return
  }

  const page = req.params.page
  if (!/^page-\d{3}\.png$/i.test(page)) {
    res.status(400).json({ success: false, message: '无效的预览页文件名。' })
    return
  }

  const imagePath = getPptPreviewImagePath(session.userId, session.id, page)
  const stat = await fs.stat(imagePath).catch(() => null)
  if (!stat || !stat.isFile()) {
    res.status(404).json({ success: false, message: '预览图不存在。' })
    return
  }

  res.sendFile(path.resolve(imagePath))
})

router.get('/sessions/:sessionId/download', async (req, res) => {
  const session = await getPptSession(req.params.sessionId)
  if (!session) {
    res.status(404).json({ success: false, message: 'PPT 会话不存在。' })
    return
  }

  const stat = await fs.stat(session.pptxPath).catch(() => null)
  if (!stat || !stat.isFile() || stat.size <= 0) {
    res.status(404).json({ success: false, message: 'PPTX 文件不存在。' })
    return
  }

  const safeTitle = sanitizePathSegment(session.title, 'presentation')
  res.download(session.pptxPath, `${safeTitle}.pptx`)
})

export default router
