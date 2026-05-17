import { ImapFlow } from 'imapflow'
import type { ImapFlowOptions, Logger } from 'imapflow'

type Stage = 'prepare' | 'connect' | 'auth' | 'mailbox' | 'fetch' | 'logout'

interface StageRef {
  current: Stage
  connectOkLogged: boolean
  authStartLogged: boolean
  authOkLogged: boolean
}

interface SmokeConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

const IMAP_OPTIONS = {
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
} as const

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 2; i < process.argv.length; i += 1) {
    const part = process.argv[i]
    if (!part.startsWith('--')) continue
    const key = part.slice(2)
    const next = process.argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = 'true'
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return /^(1|true|yes)$/i.test(value.trim())
}

function maskUsername(username: string): string {
  const [name, domain] = username.split('@')
  if (!domain) return username.length <= 2 ? '**' : `${username.slice(0, 2)}***`
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2)
  return `${visible}***@${domain}`
}

function loadConfig(): SmokeConfig {
  const args = parseArgs()
  const host = args.host ?? process.env.IMAP_HOST ?? process.env.AI_OFFICE_IMAP_HOST
  const port = Number(args.port ?? process.env.IMAP_PORT ?? process.env.AI_OFFICE_IMAP_PORT ?? 993)
  const secure = parseBoolean(args.secure ?? process.env.IMAP_SECURE ?? process.env.AI_OFFICE_IMAP_SECURE, true)
  const user = args.user ?? process.env.IMAP_USER ?? process.env.AI_OFFICE_EMAIL_USER
  const password = args.password ?? process.env.IMAP_PASSWORD ?? process.env.AI_OFFICE_EMAIL_PASSWORD

  if (!host || !user || !password || !Number.isFinite(port)) {
    throw new Error(
      '缺少 IMAP 参数。示例：npm run smoke:imap -- --host outlook.office365.com --port 993 --secure true --user name@example.com --password <password>；也可使用环境变量 IMAP_HOST/IMAP_PORT/IMAP_SECURE/IMAP_USER/IMAP_PASSWORD。',
    )
  }

  return { host, port, secure, user, password }
}

function logStep(config: SmokeConfig, stage: string, extra?: Record<string, unknown>): void {
  console.info('[imap-smoke]', {
    stage,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: maskUsername(config.user),
    folder: 'INBOX',
    ...(extra ?? {}),
  })
}

function logError(config: SmokeConfig, stage: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[imap-smoke]', {
    stage,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: maskUsername(config.user),
    folder: 'INBOX',
    code: (err as NodeJS.ErrnoException).code,
    error: message,
    hint: /Authentication|LOGIN|auth|Login is disabled/i.test(message)
      ? '可能需要 OAuth2 / Modern Auth，而不是普通密码直连。'
      : undefined,
  })
}

function assertNotSmtpConfig(config: SmokeConfig): void {
  const problems: string[] = []
  if (config.host.toLowerCase().includes('smtp')) problems.push('host 看起来是 SMTP 服务器')
  if ([25, 465, 587].includes(config.port)) problems.push(`port=${config.port} 看起来是 SMTP 端口`)
  if (problems.length) {
    throw new Error(`疑似混用了 SMTP 与 IMAP 配置：${problems.join('；')}`)
  }
}

function createLogger(config: SmokeConfig, stageRef: StageRef): Logger {
  const observe = (obj: any) => {
    if (obj?.src === 'connection' && typeof obj.msg === 'string' && obj.msg.includes('Established')) {
      stageRef.connectOkLogged = true
      logStep(config, 'connect:ok', {
        tlsAuthorized: obj.authorized,
        tlsVersion: obj.version,
      })
    }
  }

  return {
    debug: observe,
    info: observe,
    warn: observe,
    error: (obj: any) => logError(config, `${stageRef.current}:imapflow-error`, obj?.err ?? obj?.error ?? obj),
  }
}

const authenticateViaImapFlow = (
  ImapFlow.prototype as unknown as {
    authenticate(this: ImapFlow): Promise<unknown>
  }
).authenticate

class SmokeImapFlow extends ImapFlow {
  constructor(
    options: ImapFlowOptions,
    private readonly smokeConfig: SmokeConfig,
    private readonly stageRef: StageRef,
  ) {
    super(options)
  }

  async authenticate(): Promise<unknown> {
    this.stageRef.current = 'auth'
    this.stageRef.authStartLogged = true
    logStep(this.smokeConfig, 'auth:start')
    const result = await authenticateViaImapFlow.call(this)
    this.stageRef.authOkLogged = true
    logStep(this.smokeConfig, 'auth:ok')
    return result
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const stageRef: StageRef = {
    current: 'prepare',
    connectOkLogged: false,
    authStartLogged: false,
    authOkLogged: false,
  }

  logStep(config, 'prepare', { timeouts: IMAP_OPTIONS })
  assertNotSmtpConfig(config)

  const client = new SmokeImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: createLogger(config, stageRef),
    ...IMAP_OPTIONS,
  }, config, stageRef)

  try {
    stageRef.current = 'connect'
    logStep(config, 'connect:start')
    await client.connect()
    if (!stageRef.connectOkLogged) logStep(config, 'connect:ok')
    if (!stageRef.authStartLogged) logStep(config, 'auth:start')
    if (!stageRef.authOkLogged) logStep(config, 'auth:ok')

    stageRef.current = 'mailbox'
    logStep(config, 'mailbox:start')
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true })
    logStep(config, 'mailbox:ok', { exists: mailbox.exists })

    stageRef.current = 'fetch'
    const start = Math.max(1, mailbox.exists - 5 + 1)
    const range = mailbox.exists > 0 ? `${start}:${mailbox.exists}` : ''
    logStep(config, 'fetch:start', { range: range || '(empty)', limit: 5 })

    const subjects: string[] = []
    if (range) {
      for await (const message of client.fetch(range, { envelope: true, uid: true })) {
        subjects.push(message.envelope.subject || '(无主题)')
      }
    }
    logStep(config, 'fetch:ok', { count: subjects.length, subjects: subjects.reverse() })
  } catch (err) {
    logError(config, `${stageRef.current}:failed`, err)
    process.exitCode = 1
  } finally {
    stageRef.current = 'logout'
    try {
      await client.logout()
      logStep(config, 'logout:ok')
    } catch (err) {
      logError(config, 'logout:failed', err)
    }
  }
}

main().catch((err) => {
  console.error('[imap-smoke]', {
    stage: 'fatal',
    error: err instanceof Error ? err.message : String(err),
  })
  process.exitCode = 1
})
