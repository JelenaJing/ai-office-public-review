/**
 * voiceProxyService.ts
 *
 * Proxies WebSocket connections to the voice recognition service from the
 * main process (Node.js) so that self-signed TLS certificates are handled
 * natively without touching Chromium's SSL stack.
 *
 * IPC channels:
 *   voice:start  → start a session, returns sessionId
 *   voice:send   → send audio chunk (ArrayBuffer) to service
 *   voice:stop   → stop and clean up session
 *   voice:event  → pushed from main to renderer (result / error / status)
 */

import { app, BrowserWindow, ipcMain, webContents } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type WsModule from 'ws'
import type { WebSocket as WsClient } from 'ws'

const _require = createRequire(import.meta.url)
// require('ws') returns the WebSocket constructor directly (CommonJS default export)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebSocket = _require('ws') as typeof WsModule

const WS_VOICE_API_URLS = [
  'wss://10.20.5.62:8123/ws',
  'ws://10.20.5.62:8123/ws',
]
const WS_CONNECT_TIMEOUT_MS = 10_000

type SessionId = string

interface VoiceSession {
  ws: WsClient
  senderId: number
  closed: boolean
  captureWindow: BrowserWindow | null
}

const sessions = new Map<SessionId, VoiceSession>()
const voiceCaptureWebContentsIds = new Set<number>()
let _sessionCounter = 0

function makeSessionId(): SessionId {
  _sessionCounter += 1
  return `voice-session-${_sessionCounter}`
}

function pushEvent(senderId: number, sessionId: SessionId, payload: Record<string, unknown>): void {
  try {
    const wc = webContents.fromId(senderId)
    if (wc && !wc.isDestroyed()) {
      wc.send('voice:event', { sessionId, ...payload })
    }
  } catch {
    // renderer may have been destroyed
  }
}

export function isVoiceCaptureWebContentsId(webContentsId: number | undefined): boolean {
  return typeof webContentsId === 'number' && voiceCaptureWebContentsIds.has(webContentsId)
}

function resolveVoiceApiUrls(): string[] {
  const configuredUrl = String(process.env.AI_WRITER_WS_VOICE_URL || '').trim()
  return Array.from(new Set([configuredUrl, ...WS_VOICE_API_URLS].filter(Boolean)))
}

function closeStartupSocket(ws: WsClient): void {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate()
    }
  } catch {
    // best-effort cleanup after a failed handshake
  }
}

async function connectVoiceWebSocket(): Promise<WsClient> {
  let lastError: Error | null = null

  for (const url of resolveVoiceApiUrls()) {
    const ws = new WebSocket(url, {
      rejectUnauthorized: false, // self-signed certificates are expected for the local WSS service
    }) as WsClient

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          fn()
        }
        const timeout = setTimeout(() => {
          finish(() => reject(new Error('连接语音识别服务超时，请检查服务是否已启动')))
        }, WS_CONNECT_TIMEOUT_MS)

        ws.once('open', () => finish(resolve))
        ws.once('error', (err) => finish(() => reject(err)))
      })

      return ws
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      closeStartupSocket(ws)
    }
  }

  throw new Error(`无法连接到语音识别服务，请检查网络或服务状态：${lastError?.message || '未知错误'}`)
}

function buildVoiceCaptureHtml(sessionId: SessionId): string {
  return `<!doctype html>
<html>
<body>
<script>
const { ipcRenderer } = require('electron')
const sessionId = ${JSON.stringify(sessionId)}
const targetRate = 16000
let closed = false
let stream = null
let audioContext = null
let sourceNode = null
let processorNode = null

function resampleTo16k(input, inputRate) {
  const ratio = inputRate / targetRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let i = 0; i < outputLength; i += 1) {
    const pos = i * ratio
    const floor = Math.floor(pos)
    const frac = pos - floor
    const a = input[floor] || 0
    const b = floor + 1 < input.length ? input[floor + 1] : a
    output[i] = a + (b - a) * frac
  }
  return output
}

function cleanup() {
  closed = true
  if (processorNode) processorNode.onaudioprocess = null
  try { sourceNode && sourceNode.disconnect() } catch {}
  try { processorNode && processorNode.disconnect() } catch {}
  try { stream && stream.getTracks().forEach((track) => track.stop()) } catch {}
  try { audioContext && audioContext.state !== 'closed' && audioContext.close() } catch {}
}

window.addEventListener('beforeunload', cleanup)

async function start() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前 Electron 采集页面无法访问麦克风 API')
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
    audioContext = new AudioContext({ latencyHint: 'interactive' })
    if (audioContext.state === 'suspended') await audioContext.resume()
    const inputRate = audioContext.sampleRate
    sourceNode = audioContext.createMediaStreamSource(stream)
    processorNode = audioContext.createScriptProcessor(4096, 1, 1)
    processorNode.onaudioprocess = (event) => {
      if (closed) return
      const channelData = event.inputBuffer.getChannelData(0)
      const processed = inputRate === targetRate ? channelData.slice() : resampleTo16k(channelData, inputRate)
      ipcRenderer.send('voice:capture-audio', sessionId, processed.buffer.slice(0))
    }
    sourceNode.connect(processorNode)
    processorNode.connect(audioContext.destination)
    ipcRenderer.send('voice:capture-ready', sessionId)
  } catch (error) {
    ipcRenderer.send('voice:capture-error', sessionId, error && error.message ? error.message : String(error || 'unknown error'))
  }
}

start()
</script>
</body>
</html>`
}

async function startCaptureWindow(sessionId: SessionId, session: VoiceSession): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const captureWindow = new BrowserWindow({
      width: 320,
      height: 180,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    })
    session.captureWindow = captureWindow
    const captureWebContentsId = captureWindow.webContents.id
    voiceCaptureWebContentsIds.add(captureWebContentsId)

    const cleanupStartupListeners = () => {
      clearTimeout(timeout)
      ipcMain.removeListener('voice:capture-ready', onReady)
      ipcMain.removeListener('voice:capture-error', onError)
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanupStartupListeners()
      fn()
    }
    const closeCaptureWindow = () => {
      try {
        if (!captureWindow.isDestroyed()) captureWindow.close()
      } catch {
        // best-effort cleanup
      }
    }
    const timeout = setTimeout(() => {
      finish(() => {
        closeCaptureWindow()
        reject(new Error('启动麦克风超时，请检查系统麦克风权限'))
      })
    }, WS_CONNECT_TIMEOUT_MS)
    const onReady = (_event: Electron.IpcMainEvent, readySessionId: SessionId) => {
      if (readySessionId !== sessionId) return
      finish(resolve)
    }
    const onError = (_event: Electron.IpcMainEvent, errorSessionId: SessionId, message: string) => {
      if (errorSessionId !== sessionId) return
      finish(() => {
        closeCaptureWindow()
        reject(new Error(message || '麦克风采集启动失败'))
      })
    }

    ipcMain.on('voice:capture-ready', onReady)
    ipcMain.on('voice:capture-error', onError)

    captureWindow.webContents.on('render-process-gone', (_event, details) => {
      finish(() => {
        voiceCaptureWebContentsIds.delete(captureWebContentsId)
        reject(new Error(`麦克风采集进程崩溃（${details.reason}），请检查麦克风驱动或系统隐私权限`))
      })
    })
    captureWindow.on('closed', () => {
      voiceCaptureWebContentsIds.delete(captureWebContentsId)
      if (session.captureWindow === captureWindow) {
        session.captureWindow = null
      }
      if (!settled && !session.closed) {
        finish(() => reject(new Error('麦克风采集窗口已关闭')))
      }
    })

    const captureHtmlPath = path.join(app.getPath('userData'), 'voice-capture.html')
    try {
      fs.writeFileSync(captureHtmlPath, buildVoiceCaptureHtml(sessionId), 'utf8')
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      return
    }

    captureWindow.loadFile(captureHtmlPath).catch((error) => {
      finish(() => {
        closeCaptureWindow()
        reject(error)
      })
    })
  })
}

export function registerVoiceProxyIpc(): void {
  // voice:start → create WebSocket session in main process
  ipcMain.handle('voice:start', async (event): Promise<{ sessionId: string }> => {
    const sessionId = makeSessionId()
    const senderId = event.sender.id

    const ws = await connectVoiceWebSocket()
    const session: VoiceSession = { ws, senderId, closed: false, captureWindow: null }
    sessions.set(sessionId, session)

    ws.on('message', (data) => {
      if (session.closed) return
      try {
        const json = JSON.parse(data.toString()) as Record<string, unknown>
        const text = String(json.text || '').trim()
        if (text) {
          pushEvent(senderId, sessionId, { type: 'result', text })
        }
      } catch {
        // ignore non-JSON messages
      }
    })

    ws.on('error', (err) => {
      if (session.closed) return
      pushEvent(senderId, sessionId, { type: 'error', message: `语音识别服务出错：${err.message}` })
    })

    ws.on('close', (code) => {
      if (session.closed) return
      session.closed = true
      sessions.delete(sessionId)
      if (session.captureWindow && !session.captureWindow.isDestroyed()) {
        session.captureWindow.close()
      }
      if (code !== 1000 && code !== 1001) {
        pushEvent(senderId, sessionId, {
          type: 'error',
          message: `语音识别服务连接已断开（${code}），请重新点击麦克风继续`,
        })
      }
    })

    try {
      await startCaptureWindow(sessionId, session)
    } catch (error) {
      session.closed = true
      sessions.delete(sessionId)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000)
      }
      throw error
    }

    return { sessionId }
  })

  // voice:send → forward PCM audio buffer to service
  ipcMain.on('voice:send', (_event, sessionId: SessionId, buffer: Buffer) => {
    const session = sessions.get(sessionId)
    if (!session || session.closed || session.ws.readyState !== WebSocket.OPEN) return
    try {
      session.ws.send(buffer)
    } catch {
      // ignore send errors
    }
  })

  ipcMain.on('voice:capture-audio', (_event, sessionId: SessionId, buffer: ArrayBuffer) => {
    const session = sessions.get(sessionId)
    if (!session || session.closed || session.ws.readyState !== WebSocket.OPEN) return
    try {
      session.ws.send(Buffer.from(buffer))
    } catch {
      // ignore send errors
    }
  })

  // voice:stop → close session
  ipcMain.handle('voice:stop', async (_event, sessionId: SessionId): Promise<void> => {
    const session = sessions.get(sessionId)
    if (!session) return
    session.closed = true
    sessions.delete(sessionId)
    if (session.captureWindow && !session.captureWindow.isDestroyed()) {
      session.captureWindow.close()
    }
    if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
      session.ws.close(1000)
    }
  })
}
