import nodemailer from 'nodemailer'

type SeedMail = {
  fromName: string
  subject: string
  text: string
}

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  to: string
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少环境变量：${name}`)
  }
  return value
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`AIOFFICE_SEED_SMTP_PORT 必须是有效端口号，当前值：${value}`)
  }
  return port
}

function parseSecure(value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('AIOFFICE_SEED_SMTP_SECURE 只能设置为 true 或 false')
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function nextWeekday(date: Date, weekday: number, minDays = 1): Date {
  let offset = (weekday - date.getDay() + 7) % 7
  while (offset < minDays) {
    offset += 7
  }
  return addDays(date, offset)
}

function atTime(date: Date, hour: number, minute = 0): Date {
  const next = new Date(date)
  next.setHours(hour, minute, 0, 0)
  return next
}

function formatChineseDate(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`
}

function formatChineseDateTime(date: Date, hour?: number, minute = 0): string {
  const target = typeof hour === 'number' ? atTime(date, hour, minute) : new Date(date)
  return `${formatChineseDate(target)}${String(target.getHours()).padStart(2, '0')}:${String(
    target.getMinutes()
  ).padStart(2, '0')}`
}

function formatTimeRange(date: Date, startHour: number, endHour: number, startMinute = 0, endMinute = 0): string {
  return `${formatChineseDate(date)} ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(
    2,
    '0'
  )} - ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
}

function getEmailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) {
    throw new Error(`邮箱地址格式无效：${email}`)
  }
  return email.slice(at + 1).toLowerCase()
}

function parseInternalDomains(): string[] {
  return (process.env.AIOFFICE_SEED_INTERNAL_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

function isRecognizedInternalDomain(domain: string): boolean {
  const configuredDomains = parseInternalDomains()
  if (configuredDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) {
    return true
  }

  return (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.local') ||
    domain.endsWith('.lan') ||
    domain.endsWith('.internal') ||
    domain.endsWith('.intranet') ||
    domain === 'cuhksz' ||
    domain.endsWith('.cuhksz') ||
    domain.includes('aioffice')
  )
}

function assertInternalRecipient(email: string): void {
  const domain = getEmailDomain(email)
  if (!isRecognizedInternalDomain(domain)) {
    throw new Error(
      `收件人域名 ${domain} 未被识别为内部邮箱。请只发送到本地或内网账号；如需允许内网域名，请设置 AIOFFICE_SEED_INTERNAL_DOMAINS=example.local,department.internal。`
    )
  }
}

function buildSeedMails(now = new Date()): SeedMail[] {
  const tomorrow = addDays(now, 1)
  const dayAfterTomorrow = addDays(now, 2)
  const nextMonday = nextWeekday(now, 1, 2)
  const nextTuesday = nextWeekday(now, 2, 2)
  const nextWednesday = nextWeekday(now, 3, 2)
  const nextFriday = nextWeekday(now, 5, 2)
  const laterDeadline = addDays(now, 10)

  return [
    {
      fromName: '项目组秘书',
      subject: '项目会议时间确认',
      text: `你好，

想确认你明天下午 4 点到 5 点（${formatTimeRange(tomorrow, 16, 17)}）是否有空参加项目会议。会议将在 Zoom 进行，会议链接稍后发送。

如果这个时间方便，请回复确认。

谢谢。`,
    },
    {
      fromName: '学院行政',
      subject: '学院会议邀请',
      text: `你好，

学院计划在明天下午 3 点到 4 点（${formatTimeRange(tomorrow, 15, 16)}）召开工作协调会议，地点在行政楼 302 会议室。

请确认你是否可以参加。

谢谢。`,
    },
    {
      fromName: '招生办公室',
      subject: '面试时间安排确认',
      text: `你好，

你的面试安排在${formatChineseDateTime(nextFriday, 10)}到 10:30。面试将通过线上会议进行。

请确认你是否可以参加该时间段。

谢谢。`,
    },
    {
      fromName: '财务办公室',
      subject: '报销材料提交提醒',
      text: `你好，

请在${formatChineseDateTime(nextFriday, 17)}前提交本次差旅报销材料，包括发票、行程单和审批表。

如材料不完整，请尽快补充。

谢谢。`,
    },
    {
      fromName: '项目组秘书',
      subject: '讨论时间选择',
      text: `你好，

关于下周项目推进的事情，我这边${formatChineseDate(nextTuesday)}下午、${formatChineseDate(
        nextWednesday
      )}上午、${formatChineseDateTime(nextFriday, 10)}都可以。

你看哪个时间方便？我们可以安排 30 分钟沟通。

谢谢。`,
    },
    {
      fromName: '合作事务办公室',
      subject: '下周找时间沟通',
      text: `你好，

我们下周找个时间聊一下项目后续安排吧，主要想讨论一下接下来的任务分工。

你方便的时候回复我即可。

谢谢。`,
    },
    {
      fromName: '资料协调人',
      subject: '材料更新版本',
      text: `你好，

这是本周材料的更新版本，请查收附件内容。如有问题可以直接回复我。

谢谢。`,
    },
    {
      fromName: '项目组秘书',
      subject: '项目会议纪要',
      text: `你好，

附件是今天项目会议的纪要，主要包括任务分工、风险事项和下一步计划。

请查收。

谢谢。`,
    },
    {
      fromName: '访客协调人',
      subject: '会议时间调整请求',
      text: `你好，

原定明天下午 2 点（${formatChineseDateTime(tomorrow, 14)}）的沟通会议可能需要调整。请问是否可以改到后天下午 3 点到 4 点（${formatTimeRange(
        dayAfterTomorrow,
        15,
        16
      )}）？

如果你方便，请回复确认。

谢谢。`,
    },
    {
      fromName: '系统通知',
      subject: '线上同步会议安排',
      text: `你好，

我们计划在${formatChineseDate(nextMonday)}上午 10 点到 11 点（${formatTimeRange(
        nextMonday,
        10,
        11
      )}）进行线上同步会议，会议链接为 https://example.com/meeting/abc123。

请确认是否可以参加。

谢谢。`,
    },
    {
      fromName: '学院行政',
      subject: '线下工作协调会',
      text: `你好，

请参加${formatChineseDate(nextWednesday)}下午 2 点到 3 点（${formatTimeRange(
        nextWednesday,
        14,
        15
      )}）的工作协调会，地点在教学楼 B 座 506 会议室。

请提前 5 分钟到场。

谢谢。`,
    },
    {
      fromName: '资料协调人',
      subject: '材料反馈时间',
      text: `你好，

请尽量在${formatChineseDate(laterDeadline)}前反馈材料修改意见，我们需要统一汇总后提交。

谢谢。`,
    },
  ]
}

function readConfig(): SmtpConfig {
  const host = requireEnv('AIOFFICE_SEED_SMTP_HOST')
  const port = parsePort(requireEnv('AIOFFICE_SEED_SMTP_PORT'))
  const secure = parseSecure(requireEnv('AIOFFICE_SEED_SMTP_SECURE'))
  const user = requireEnv('AIOFFICE_SEED_SMTP_USER')
  const pass = requireEnv('AIOFFICE_SEED_SMTP_PASS')
  const to = requireEnv('AIOFFICE_SEED_TO')

  assertInternalRecipient(to)

  return { host, port, secure, user, pass, to }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextDelayMs(): number {
  return 300 + Math.floor(Math.random() * 501)
}

async function main(): Promise<void> {
  let config: SmtpConfig
  try {
    config = readConfig()
  } catch (error) {
    console.error('缺少 SMTP 配置，请设置 AIOFFICE_SEED_SMTP_HOST / AIOFFICE_SEED_TO 等环境变量。')
    throw error
  }

  const mails = buildSeedMails()
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })

  console.log(`准备发送 ${mails.length} 封日程功能验收邮件。`)
  console.log(`收件人：${config.to}`)

  for (const [index, mail] of mails.entries()) {
    try {
      await transporter.sendMail({
        from: `"${mail.fromName}" <${config.user}>`,
        to: config.to,
        subject: mail.subject,
        text: mail.text,
      })
      console.log(`${index + 1}. 已发送：${mail.subject}`)
    } catch (error) {
      console.error(`${index + 1}. 发送失败：${mail.subject}`)
      throw error
    }

    if (index < mails.length - 1) {
      await delay(nextDelayMs())
    }
  }

  console.log('')
  console.log(`发送完成：${mails.length} 封`)
  console.log(`收件人：${config.to}`)
  console.log('邮件主题：')
  for (const mail of mails) {
    console.log(`- ${mail.subject}`)
  }

  console.log('')
  console.log('冲突场景验证前，请先在日程管理中手动创建一个明天下午 3 点到 4 点的已确认日程：')
  console.log('标题：学院会议')
  console.log('时间：明天 15:00 - 16:00')
  console.log('类型：会议')
  console.log('状态：已确认')
  console.log('这样“学院会议邀请”邮件就能触发冲突检测。')

  console.log('')
  console.log('PowerShell 配置示例：')
  console.log('$env:AIOFFICE_SEED_SMTP_HOST="mail.aioffice.cuhksz"')
  console.log('$env:AIOFFICE_SEED_SMTP_PORT="587"')
  console.log('$env:AIOFFICE_SEED_SMTP_SECURE="false"')
  console.log('$env:AIOFFICE_SEED_SMTP_USER="sender@aioffice.local"')
  console.log('$env:AIOFFICE_SEED_SMTP_PASS="password"')
  console.log('$env:AIOFFICE_SEED_TO="target@aioffice.local"')
  console.log('npm run seed:calendar-mails')

  console.log('')
  console.log('SSL 465 配置示例：')
  console.log('$env:AIOFFICE_SEED_SMTP_HOST="mail.aioffice.cuhksz"')
  console.log('$env:AIOFFICE_SEED_SMTP_PORT="465"')
  console.log('$env:AIOFFICE_SEED_SMTP_SECURE="true"')
  console.log('$env:AIOFFICE_SEED_SMTP_USER="sender@aioffice.local"')
  console.log('$env:AIOFFICE_SEED_SMTP_PASS="password"')
  console.log('$env:AIOFFICE_SEED_TO="target@aioffice.local"')
  console.log('npm run seed:calendar-mails')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
