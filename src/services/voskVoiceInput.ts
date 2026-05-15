// 语音识别 WebSocket API 地址，服务端接受 float32 PCM (16kHz) 二进制帧
const WS_VOICE_API_URL = 'wss://10.20.5.62:8123/ws'
const SAMPLE_RATE = 16000
const WS_CONNECT_TIMEOUT_MS = 10_000

/**
 * Downsample Float32Array from inputRate to SAMPLE_RATE (16000 Hz) using
 * linear interpolation.  Runs synchronously inside onaudioprocess.
 * On most Windows systems AudioContext defaults to 44100 Hz or 48000 Hz.
 */
function linearResampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  const ratio = inputRate / SAMPLE_RATE
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio
    const floor = Math.floor(pos)
    const frac = pos - floor
    const a = input[floor] ?? 0
    const b = floor + 1 < input.length ? input[floor + 1] : a
    output[i] = a + (b - a) * frac
  }
  return output
}
const SMOKE_TEST_TRANSCRIPT = '桌面语音 smoke'

type BrowserSpeechRecognitionEvent = Event & {
  resultIndex?: number
  results?: ArrayLike<{
    isFinal?: boolean
    0?: {
      transcript?: string
    }
  }>
  error?: string
}

type BrowserSpeechRecognitionInstance = EventTarget & {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onend: ((event: Event) => void) | null
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionInstance

type AppInfoResponse = {
  wsVoiceUrl?: unknown
}

type VoskTestWindow = Window & {
  __AI_WRITER_VOSK_TEST_MODE__?: unknown
}

export interface VoskVoiceInputHandlers {
  onFinalText: (text: string) => void
  onPartialText: (text: string) => void
  onError: (message: string) => void
  onStatusChange?: (message: string) => void
}

export interface VoskVoiceInputSession {
  stop: () => Promise<void>
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null
  }

  const recognitionHost = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }

  return recognitionHost.SpeechRecognition || recognitionHost.webkitSpeechRecognition || null
}

function isLikelyLinuxDesktop(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string
    }
  }

  const platformText = [
    String(nav.userAgentData?.platform || ''),
    String(navigator.platform || ''),
    String(navigator.userAgent || ''),
  ].join(' ').toLowerCase()

  return platformText.includes('linux')
}

function isElectronRenderer(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /electron/i.test(String(navigator.userAgent || ''))
}

function hasVoskRuntimePrerequisites(): boolean {
  return typeof window !== 'undefined'
    && typeof window.AudioContext !== 'undefined'
    && typeof window.Worker !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

function shouldPreferBrowserSpeechRecognition(): boolean {
  // In Electron, the built-in Chromium SpeechRecognition requires Google's online servers,
  // which are typically inaccessible. Skip it and use Vosk for offline recognition instead.
  if (isElectronRenderer()) {
    return false
  }
  return Boolean(getSpeechRecognitionConstructor()) && !isLikelyLinuxDesktop()
}

function normalizeSpeechRecognitionError(errorCode: string): string {
  const normalizedCode = String(errorCode || '').trim().toLowerCase()
  if (normalizedCode === 'not-allowed' || normalizedCode === 'service-not-allowed') {
    return '麦克风权限被拒绝，无法使用语音输入'
  }
  if (normalizedCode === 'audio-capture') {
    return '未检测到可用麦克风，无法使用语音输入'
  }
  if (normalizedCode === 'network') {
    return '在线语音识别服务暂时不可用，请检查网络后重试'
  }
  if (normalizedCode === 'no-speech') {
    return '没有检测到有效语音，请靠近麦克风后重试'
  }
  return '语音输入失败，请稍后重试'
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return `${fallback}：${error.message.trim()}`
  }
  const text = String(error || '').trim()
  return text ? `${fallback}：${text}` : fallback
}

function normalizeMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限被拒绝，无法使用语音输入'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return '未检测到可用麦克风，无法使用语音输入'
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return '麦克风当前不可用，请检查是否被其他程序占用'
    }
  }

  return normalizeErrorMessage(error, '启动麦克风失败，请稍后重试')
}

function disconnectNode(node: AudioNode | null): void {
  if (!node) return
  try {
    node.disconnect()
  } catch {
    return
  }
}

function clearMediaStream(stream: MediaStream | null): void {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

function getVoskTestMode(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const globalValue = String((window as VoskTestWindow).__AI_WRITER_VOSK_TEST_MODE__ || '').trim()
  if (globalValue) {
    return globalValue.toLowerCase()
  }

  try {
    const storedValue = String(window.localStorage?.getItem('AI_WRITER_VOSK_TEST_MODE') || '').trim()
    return storedValue.toLowerCase()
  } catch {
    return ''
  }
}

export function isVoskVoiceInputTestMode(): boolean {
  return getVoskTestMode() === 'smoke'
}

async function resolveWsVoiceApiUrl(): Promise<string> {
  if (typeof window === 'undefined' || !window.electronAPI?.getAppInfo) {
    return WS_VOICE_API_URL
  }
  try {
    const appInfo = await window.electronAPI.getAppInfo() as AppInfoResponse
    const url = String(appInfo?.wsVoiceUrl || '').trim()
    return url || WS_VOICE_API_URL
  } catch {
    return WS_VOICE_API_URL
  }
}

async function startSmokeVoskVoiceInput(
  handlers: VoskVoiceInputHandlers,
): Promise<VoskVoiceInputSession> {
  let stopped = false
  let partialTimer: number | null = window.setTimeout(() => {
    if (stopped) return
    handlers.onPartialText(SMOKE_TEST_TRANSCRIPT)
  }, 80)

  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      if (partialTimer !== null) {
        window.clearTimeout(partialTimer)
        partialTimer = null
      }
      handlers.onFinalText(SMOKE_TEST_TRANSCRIPT)
    },
  }
}

async function startBrowserSpeechVoiceInput(
  handlers: VoskVoiceInputHandlers,
): Promise<VoskVoiceInputSession> {
  const SpeechRecognition = getSpeechRecognitionConstructor()
  if (!SpeechRecognition) {
    throw new Error('当前环境不支持快速语音输入')
  }

  const recognition = new SpeechRecognition()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let closed = false
  let stoppedByCaller = false
  let settled = false
  let resolveStop: (() => void) | null = null

  const finishStop = () => {
    if (settled) return
    settled = true
    resolveStop?.()
    resolveStop = null
  }

  recognition.onresult = (event) => {
    if (closed) return
    const results = event.results
    if (!results) return

    const startIndex = Math.max(0, Number(event.resultIndex || 0))
    let interimText = ''
    for (let index = startIndex; index < results.length; index += 1) {
      const result = results[index]
      const transcript = String(result?.[0]?.transcript || '').trim()
      if (!transcript) continue
      if (result?.isFinal) {
        handlers.onFinalText(transcript)
      } else {
        interimText = `${interimText} ${transcript}`.trim()
      }
    }

    handlers.onPartialText(interimText)
  }

  recognition.onerror = (event) => {
    if (closed) return
    const message = normalizeSpeechRecognitionError(String(event.error || ''))
    if (stoppedByCaller) {
      finishStop()
      return
    }
    handlers.onError(message)
  }

  recognition.onend = () => {
    if (closed) return
    if (stoppedByCaller) {
      finishStop()
      return
    }
    handlers.onError('语音输入已结束，请重新点击麦克风继续')
  }

  try {
    recognition.start()
  } catch (error) {
    throw new Error(normalizeErrorMessage(error, '启动快速语音输入失败'))
  }

  return {
    stop: async () => {
      if (closed) return
      closed = true
      stoppedByCaller = true
      await new Promise<void>((resolve) => {
        resolveStop = resolve
        try {
          recognition.stop()
        } catch {
          try {
            recognition.abort()
          } catch {
            resolve()
          }
        }
        window.setTimeout(resolve, 500)
      })
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
    },
  }
}

export function supportsVoskVoiceInput(): boolean {
  if (isVoskVoiceInputTestMode()) {
    return true
  }

  if (shouldPreferBrowserSpeechRecognition()) {
    return true
  }

  return hasVoskRuntimePrerequisites()
}

async function startWsVoiceInput(
  handlers: VoskVoiceInputHandlers,
): Promise<VoskVoiceInputSession> {
  const api = window.electronAPI
  if (!api?.voiceStart || !api?.voiceStop || !api?.onVoiceEvent) {
    throw new Error('当前环境不支持语音输入（缺少 IPC 接口），请改用键盘输入')
  }

  handlers.onStatusChange?.('正在启动语音输入...')

  // 主进程负责连接识别服务，并在独立隐藏窗口中采集麦克风音频。
  const { sessionId } = await api.voiceStart()

  let closed = false

  // 监听主进程推送的识别结果
  const removeEventListener = api.onVoiceEvent((payload) => {
    if (closed || payload.sessionId !== sessionId) return
    if (payload.type === 'result' && payload.text) {
      handlers.onFinalText(payload.text)
      handlers.onPartialText('')
    } else if (payload.type === 'error' && payload.message) {
      handlers.onError(payload.message)
    }
  })

  const cleanup = async () => {
    if (closed) return
    closed = true

    removeEventListener()
    await api.voiceStop!(sessionId).catch(() => undefined)
  }

  return {
    stop: async () => {
      await cleanup()
    },
  }
}

export async function startChineseVoskVoiceInput(
  handlers: VoskVoiceInputHandlers,
): Promise<VoskVoiceInputSession> {
  if (isVoskVoiceInputTestMode()) {
    return startSmokeVoskVoiceInput(handlers)
  }

  if (shouldPreferBrowserSpeechRecognition()) {
    try {
      return await startBrowserSpeechVoiceInput(handlers)
    } catch {
      // Fall through to WebSocket API if browser speech backend fails.
    }
  }

  if (!hasVoskRuntimePrerequisites()) {
    throw new Error('当前环境不支持语音输入，请改用键盘输入')
  }

  return startWsVoiceInput(handlers)
}