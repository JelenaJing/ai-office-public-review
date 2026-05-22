import type {
  EmailActionType,
  EmailAnalysisBatchSummary,
  EmailAnalysisResult,
  EmailContentTopicSummary,
  EmailImportance,
} from '../../../types/mailTriage'

const IMPORTANCE_WEIGHT: Record<EmailImportance, number> = {
  important: 3,
  normal: 2,
  low: 1,
}

const ACTION_WEIGHT: Record<EmailActionType, number> = {
  need_reply: 7,
  need_schedule: 6,
  need_review: 5,
  need_forward: 4,
  notification: 2,
  no_action: 1,
  spam_or_noise: 0,
}

const CATEGORY_LABELS: Record<string, string> = {
  spam: '风险或垃圾邮件',
  promotion: '推广与订阅邮件',
  system_notice: '系统通知',
  internal_notice: '内部通知',
  student_request: '学生事务咨询',
  colleague_collaboration: '同事协作',
  task_assignment: '任务分配',
  approval_request: '审批确认',
  meeting_invitation: '会议与日程安排',
  document_review: '文档与附件审阅',
  data_report_request: '数据与报表请求',
  project_update: '项目进展同步',
  urgent_issue: '紧急事项',
  ordinary: '普通沟通',
  action_required: '待处理任务',
  reply_required: '待回复邮件',
  read_only: '仅需阅读通知',
  archive_candidate: '可归档邮件',
  risk: '风险邮件',
  unknown: '待人工确认邮件',
}

const ACTION_LABELS: Record<EmailActionType, string> = {
  need_reply: '需要回复',
  need_review: '需要审阅',
  need_schedule: '需要安排日程',
  need_forward: '需要转发',
  notification: '通知类',
  spam_or_noise: '低价值或风险内容',
  no_action: '无需处理',
}

const IMPORTANCE_LABELS: Record<EmailImportance, string> = {
  important: '重要',
  normal: '普通',
  low: '低优先级',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category || '未分类邮件'
}

function actionLabel(actionType: EmailActionType): string {
  return ACTION_LABELS[actionType] || actionType
}

function displaySender(item: Pick<EmailAnalysisResult, 'fromName' | 'fromEmail'>): string {
  return item.fromName?.trim() || item.fromEmail?.trim() || '未知发件人'
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function countBy<T extends string>(items: T[]): Array<{ key: T; count: number }> {
  const map = new Map<T, number>()
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1)
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function importanceLevel(items: EmailAnalysisResult[]): EmailContentTopicSummary['importanceLevel'] {
  const levels = unique(items.map((item) => item.importance))
  return levels.length === 1 ? levels[0] : 'mixed'
}

function topicDescription(topic: string, items: EmailAnalysisResult[]): string {
  const needReply = items.filter((item) => item.actionType === 'need_reply').length
  const important = items.filter((item) => item.importance === 'important').length
  const actionBreakdown = countBy(items.map((item) => item.actionType))
    .slice(0, 2)
    .map(({ key, count }) => `${actionLabel(key)} ${count} 封`)
    .join('，')
  const summaryText = unique(items.map((item) => item.summary).filter(Boolean))
    .slice(0, 3)
    .join('；')
  const parts = [
    `主要围绕${topic}`,
    summaryText ? `包括${summaryText}` : '',
    actionBreakdown ? `处理类型以${actionBreakdown}为主` : '',
    important > 0 ? `其中 ${important} 封为重要邮件` : '',
    needReply > 0 ? `${needReply} 封需要回复` : '',
  ].filter(Boolean)
  return `${parts.join('，')}。`
}

function makeTopic(topic: string, items: EmailAnalysisResult[]): EmailContentTopicSummary {
  const sorted = [...items].sort((a, b) =>
    IMPORTANCE_WEIGHT[b.importance] - IMPORTANCE_WEIGHT[a.importance] ||
    ACTION_WEIGHT[b.actionType] - ACTION_WEIGHT[a.actionType],
  )
  return {
    topic,
    count: items.length,
    importanceLevel: importanceLevel(items),
    description: topicDescription(topic, items),
    relatedMessageIds: sorted.map((item) => item.messageId),
    representativeSubjects: unique(sorted.map((item) => item.subject).filter(Boolean)).slice(0, 3),
  }
}

function groupResults(
  results: EmailAnalysisResult[],
  keyFn: (item: EmailAnalysisResult) => string,
): Array<{ key: string; items: EmailAnalysisResult[] }> {
  const map = new Map<string, EmailAnalysisResult[]>()
  for (const item of results) {
    const key = keyFn(item)
    map.set(key, [...(map.get(key) ?? []), item])
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
}

function buildContentTopics(results: EmailAnalysisResult[]): EmailContentTopicSummary[] {
  const analyzed = results.filter((item) => !item.error)
  if (analyzed.length === 0) return []

  let groups = groupResults(analyzed, (item) => item.category || 'unknown')
    .map(({ key, items }) => ({ topic: categoryLabel(key), items }))

  if (groups.length < 5) {
    const splitGroups = groupResults(analyzed, (item) => `${item.category || 'unknown'}::${item.actionType}`)
      .map(({ key, items }) => {
        const [category, actionType] = key.split('::') as [string, EmailActionType]
        return {
          topic: `${categoryLabel(category)}（${actionLabel(actionType)}）`,
          items,
        }
      })
    if (splitGroups.length > groups.length) groups = splitGroups
  }

  if (groups.length < 5) {
    const splitGroups = groupResults(analyzed, (item) => `${item.category || 'unknown'}::${item.actionType}::${item.importance}`)
      .map(({ key, items }) => {
        const [category, actionType, importance] = key.split('::') as [string, EmailActionType, EmailImportance]
        return {
          topic: `${categoryLabel(category)}（${actionLabel(actionType)}，${IMPORTANCE_LABELS[importance]}）`,
          items,
        }
      })
    if (splitGroups.length > groups.length) groups = splitGroups
  }

  if (groups.length > 8) {
    const top = groups.slice(0, 7)
    const rest = groups.slice(7).flatMap((group) => group.items)
    groups = [...top, { topic: '其他相关邮件', items: rest }]
  }

  return groups.slice(0, 8).map((group) => makeTopic(group.topic, group.items))
}

function buildSenderStats(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['senderStats'] {
  const map = new Map<string, EmailAnalysisBatchSummary['senderStats'][number]>()
  for (const item of results) {
    const fromEmail = item.fromEmail?.trim() || '未知邮箱'
    const current = map.get(fromEmail) ?? {
      fromName: item.fromName,
      fromEmail,
      count: 0,
      importantCount: 0,
      subjects: [],
    }
    current.fromName = current.fromName || item.fromName
    current.count += 1
    if (!item.error && item.importance === 'important') current.importantCount += 1
    current.subjects = unique([...current.subjects, item.subject].filter(Boolean)).slice(0, 5)
    map.set(fromEmail, current)
  }
  return [...map.values()].sort((a, b) =>
    b.count - a.count ||
    b.importantCount - a.importantCount ||
    displaySender(a).localeCompare(displaySender(b)),
  )
}

function buildFailedItems(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['failedItems'] {
  return results
    .filter((item) => item.error)
    .map((item) => ({
      messageId: item.messageId,
      subject: item.subject,
      fromName: item.fromName,
      fromEmail: item.fromEmail,
      error: item.error || '分析失败',
    }))
}

function buildCategoryStats(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['categoryStats'] {
  return countBy(results.filter((item) => !item.error).map((item) => item.category || 'unknown'))
    .map(({ key, count }) => ({ category: key, count }))
}

function buildCalendarStats(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['calendarStats'] {
  const analyzed = results.filter((item) => !item.error && item.timeIntent?.hasTimeRequirement)
  return {
    meetingOrInterviewCount: analyzed.filter((item) => item.timeIntent?.type === 'meeting' || item.timeIntent?.type === 'interview' || item.timeIntent?.type === 'appointment').length,
    deadlineCount: analyzed.filter((item) => item.timeIntent?.type === 'deadline').length,
    candidateTimesCount: analyzed.filter((item) => item.timeIntent?.type === 'candidate_times').length,
    conflictCount: analyzed.filter((item) => (item.calendarConflictCount ?? 0) > 0).length,
    tentativeEventCount: analyzed.filter((item) => item.timeIntent?.needsUserConfirmation || item.calendarEventId).length,
  }
}

function buildCalendarItems(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['calendarItems'] {
  const analyzed = results.filter((item) => !item.error && item.timeIntent?.hasTimeRequirement)
  return {
    pending: analyzed
      .filter((item) => item.timeIntent?.needsUserConfirmation)
      .slice(0, 8)
      .map((item) => ({
        messageId: item.messageId,
        subject: item.subject,
        title: item.timeIntent?.title || item.subject,
        startTime: item.timeIntent?.startTime,
        deadlineTime: item.timeIntent?.deadlineTime,
      })),
    conflicts: analyzed
      .filter((item) => (item.calendarConflictCount ?? 0) > 0)
      .slice(0, 8)
      .map((item) => ({
        messageId: item.messageId,
        subject: item.subject,
        title: item.timeIntent?.title || item.subject,
        conflictCount: item.calendarConflictCount ?? 0,
      })),
    deadlines: analyzed
      .filter((item) => item.timeIntent?.type === 'deadline')
      .slice(0, 8)
      .map((item) => ({
        messageId: item.messageId,
        subject: item.subject,
        title: item.timeIntent?.title || item.subject,
        deadlineTime: item.timeIntent?.deadlineTime,
      })),
  }
}

function buildTopImportantEmails(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['topImportantEmails'] {
  return results
    .filter((item) => !item.error && item.importance === 'important')
    .sort((a, b) =>
      ACTION_WEIGHT[b.actionType] - ACTION_WEIGHT[a.actionType] ||
      (a.receivedAt || '').localeCompare(b.receivedAt || ''),
    )
    .slice(0, 10)
    .map((item) => ({
      messageId: item.messageId,
      fromName: item.fromName,
      fromEmail: item.fromEmail,
      subject: item.subject,
      reason: item.reason || item.summary,
      actionType: item.actionType,
    }))
}

function suggestedNextStep(item: EmailAnalysisResult): string {
  if ((item.calendarConflictCount ?? 0) > 0) return `存在时间冲突，建议先生成改期回复`
  if (item.timeIntent?.type === 'candidate_times') return '选择可用候选时间并回复'
  if (item.timeIntent?.hasTimeRequirement) return '确认日程安排并回复相关方'
  if (item.deadlineText) return `${actionLabel(item.actionType)}，关注截止时间：${item.deadlineText}`
  if (item.hasDraftReply && item.actionType === 'need_reply') return '查看并确认已生成的预回复草稿'
  if (item.actionType === 'need_reply') return '优先阅读并回复'
  if (item.actionType === 'need_review') return '优先审阅邮件内容或附件'
  if (item.actionType === 'need_schedule') return '确认日程安排并回复相关方'
  if (item.actionType === 'need_forward') return '确认转发对象后处理'
  if (item.importance === 'important') return item.reason || '优先查看并人工判断下一步'
  return item.reason || item.summary || '查看邮件详情'
}

function buildActionItems(results: EmailAnalysisResult[]): EmailAnalysisBatchSummary['actionItems'] {
  return results
    .filter((item) => {
      if (item.error) return false
      if (item.actionType === 'spam_or_noise' || item.actionType === 'no_action') return false
      return item.importance === 'important' || item.actionType !== 'notification'
    })
    .sort((a, b) =>
      IMPORTANCE_WEIGHT[b.importance] - IMPORTANCE_WEIGHT[a.importance] ||
      ACTION_WEIGHT[b.actionType] - ACTION_WEIGHT[a.actionType],
    )
    .slice(0, 15)
    .map((item) => ({
      messageId: item.messageId,
      subject: item.subject,
      fromName: item.fromName,
      fromEmail: item.fromEmail,
      actionType: item.actionType,
      suggestedNextStep: suggestedNextStep(item),
      deadlineText: item.deadlineText,
      timeIntent: item.timeIntent,
    }))
}

function buildContentOverviewText(totalEmails: number, topics: EmailContentTopicSummary[]): string {
  if (topics.length === 0) return `本次 ${totalEmails} 封未读邮件没有足够的成功分析结果用于归纳内容主题。`

  const lines = [
    `本次 ${totalEmails} 封未读邮件主要集中在以下 ${topics.length} 类：`,
    '',
    ...topics.flatMap((topic, index) => [
      `${index + 1}. ${topic.topic}：共 ${topic.count} 封`,
      `   ${topic.description}`,
      topic.representativeSubjects.length
        ? `   代表邮件：${topic.representativeSubjects.join('；')}`
        : '',
      '',
    ].filter(Boolean)),
  ]
  return lines.join('\n').trim()
}

function buildReportText(summary: Omit<EmailAnalysisBatchSummary, 'reportText' | 'contentOverviewText'>): string {
  const senderLines = summary.senderStats.slice(0, 5).map((sender) => {
    const importantPart = sender.importantCount > 0
      ? `其中 ${sender.importantCount} 封重要`
      : '暂无重要邮件'
    return `- ${displaySender(sender)}：${sender.count} 封，${importantPart}`
  })

  const importantLines = summary.actionItems.slice(0, 5).map((item, index) =>
    `${index + 1}. ${displaySender(item)}关于“${item.subject || '无主题'}”的邮件，${suggestedNextStep({
      messageId: item.messageId,
      fromName: item.fromName,
      fromEmail: item.fromEmail,
      subject: item.subject,
      importance: 'important',
      category: '',
      actionType: item.actionType,
      summary: item.suggestedNextStep,
      reason: item.suggestedNextStep,
      hasDraftReply: false,
      deadlineText: item.deadlineText,
    })}。`
  )

  const topicNames = summary.contentTopics.map((topic) => topic.topic).slice(0, 6).join('、')
  const failedText = summary.failedCount > 0
    ? `其中 ${summary.failedCount} 封邮件分析失败，建议稍后重试。\n${summary.failedItems.slice(0, 3).map((item) => `- ${displaySender(item)}关于“${item.subject || '无主题'}”：${item.error}`).join('\n')}\n\n`
    : ''
  const calendarLines = [
    `会议/面试安排：${summary.calendarStats.meetingOrInterviewCount} 封`,
    `截止事项：${summary.calendarStats.deadlineCount} 封`,
    `多候选时间：${summary.calendarStats.candidateTimesCount} 封`,
    `时间冲突：${summary.calendarStats.conflictCount} 封`,
    `已加入待确认日程：${summary.calendarStats.tentativeEventCount} 个`,
  ].map((line) => `- ${line}`)

  return [
    `本次共分析 ${summary.totalEmails} 封未读邮件，其中重要邮件 ${summary.importantCount} 封，普通邮件 ${summary.normalCount} 封，低优先级邮件 ${summary.lowCount} 封。`,
    '',
    failedText.trim(),
    '主要发件人：',
    senderLines.length ? senderLines.join('\n') : '- 暂无发件人统计',
    '',
    '需要优先处理：',
    importantLines.length ? importantLines.join('\n') : '暂无需要优先处理的邮件。',
    '',
    '邮件内容概览：',
    topicNames ? `本批邮件主要集中在${topicNames}几个方向。` : '暂无足够内容用于主题归纳。',
    '',
    '日程发现：',
    calendarLines.join('\n'),
    '',
    `已生成预回复草稿 ${summary.draftReplyCount} 封。建议先处理 ${summary.importantCount} 封重要邮件，再批量查看普通邮件。`,
  ].filter((part) => part !== '').join('\n')
}

export function buildEmailAnalysisBatchSummary(
  batchId: string,
  results: EmailAnalysisResult[],
): EmailAnalysisBatchSummary {
  const analyzedResults = results.filter((item) => !item.error)
  const contentTopics = buildContentTopics(results)
  const summaryWithoutText: Omit<EmailAnalysisBatchSummary, 'reportText' | 'contentOverviewText'> = {
    batchId,
    createdAt: new Date().toISOString(),
    totalEmails: results.length,
    analyzedCount: analyzedResults.length,
    failedCount: results.length - analyzedResults.length,
    failedItems: buildFailedItems(results),
    importantCount: analyzedResults.filter((item) => item.importance === 'important').length,
    normalCount: analyzedResults.filter((item) => item.importance === 'normal').length,
    lowCount: analyzedResults.filter((item) => item.importance === 'low').length,
    needReplyCount: analyzedResults.filter((item) => item.actionType === 'need_reply').length,
    noActionCount: analyzedResults.filter((item) => item.actionType === 'no_action').length,
    draftReplyCount: analyzedResults.filter((item) => item.hasDraftReply).length,
    senderStats: buildSenderStats(results),
    categoryStats: buildCategoryStats(results),
    calendarStats: buildCalendarStats(results),
    calendarItems: buildCalendarItems(results),
    contentTopics,
    topImportantEmails: buildTopImportantEmails(results),
    actionItems: buildActionItems(results),
  }

  return {
    ...summaryWithoutText,
    reportText: buildReportText(summaryWithoutText),
    contentOverviewText: buildContentOverviewText(results.length, contentTopics),
  }
}
