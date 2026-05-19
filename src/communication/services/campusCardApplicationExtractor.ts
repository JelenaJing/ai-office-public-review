/**
 * campusCardApplicationExtractor.ts
 *
 * Structured field extractor for campus card replacement applications.
 * Parses email body, sender address, and attachment names to extract
 * key application fields without relying on fixed keyword presence.
 */

export interface CampusCardApplicationFields {
  applicantName?: string
  studentId?: string
  schoolEmail?: string
  reason?: string
  hasLostStatement: boolean
  hasReplacementIntent: boolean
  mentionedCampusCard: boolean
  providedFields: string[]
  missingFields: string[]
  evidence: Array<{
    field: string
    value: string
    source: 'email_body' | 'sender_email' | 'attachment_name'
  }>
}

const REQUIRED_FIELDS = ['applicantName', 'studentId', 'schoolEmail', 'reason'] as const
const FIELD_LABELS: Record<string, string> = {
  applicantName: '姓名',
  studentId: '学号',
  schoolEmail: '学校邮箱',
  reason: '补办原因',
}

export function extractCampusCardApplicationFields(input: {
  emailBody: string
  senderEmail: string
  attachmentNames: string[]
}): CampusCardApplicationFields {
  const { emailBody, senderEmail, attachmentNames } = input
  const body = emailBody ?? ''

  const evidence: CampusCardApplicationFields['evidence'] = []

  // ── 1. Applicant name ────────────────────────────────────────────────────────
  let applicantName: string | undefined
  // "姓名：张三" / "姓名:张三"
  const nameMatch1 = body.match(/姓名[：:]\s*([^\s,，。\n]{2,10})/)
  // "Name: Zhang San"
  const nameMatch2 = body.match(/Name[：:\s]+([A-Za-z][\w\s-]{1,30})/i)
  // "我是张三" — 2-4 Chinese chars after 我是
  const nameMatch3 = body.match(/我是([^\s,，。\n]{2,6})/)

  if (nameMatch1) {
    applicantName = nameMatch1[1].trim()
    evidence.push({ field: 'applicantName', value: applicantName, source: 'email_body' })
  } else if (nameMatch2) {
    applicantName = nameMatch2[1].trim()
    evidence.push({ field: 'applicantName', value: applicantName, source: 'email_body' })
  } else if (nameMatch3) {
    applicantName = nameMatch3[1].trim()
    evidence.push({ field: 'applicantName', value: applicantName, source: 'email_body' })
  }

  // ── 2. Student ID ────────────────────────────────────────────────────────────
  let studentId: string | undefined
  // "学号：12345678" / "Student ID: STU20221001"
  const idMatch1 = body.match(/学号[：:]\s*([A-Za-z]?\d{7,12})/)
  const idMatch2 = body.match(/Student\s*ID[：:\s]+([A-Za-z]{0,3}\d{7,12})/i)
  // Standalone STU-prefixed number or 8-12 digit standalone number
  const idMatch3 = body.match(/\b(STU\d{6,10})\b/i)
  const idMatch4 = body.match(/\b(\d{8,12})\b/)

  if (idMatch1) {
    studentId = idMatch1[1].trim()
    evidence.push({ field: 'studentId', value: studentId, source: 'email_body' })
  } else if (idMatch2) {
    studentId = idMatch2[1].trim()
    evidence.push({ field: 'studentId', value: studentId, source: 'email_body' })
  } else if (idMatch3) {
    studentId = idMatch3[1].trim()
    evidence.push({ field: 'studentId', value: studentId, source: 'email_body' })
  } else if (idMatch4) {
    studentId = idMatch4[1].trim()
    evidence.push({ field: 'studentId', value: studentId, source: 'email_body' })
  }

  // ── 3. School email ───────────────────────────────────────────────────────────
  let schoolEmail: string | undefined
  const schoolEmailDomains = /@(cuhk\.edu\.hk|cuhksz\.edu\.cn|link\.cuhk\.edu\.cn|cuhk\.edu\.cn)/i
  if (schoolEmailDomains.test(senderEmail)) {
    schoolEmail = senderEmail
    evidence.push({ field: 'schoolEmail', value: schoolEmail, source: 'sender_email' })
  } else {
    // Try to find one in the email body
    const bodyEmailMatch = body.match(/[\w.+-]+@(?:cuhk\.edu\.hk|cuhksz\.edu\.cn|link\.cuhk\.edu\.cn|cuhk\.edu\.cn)/i)
    if (bodyEmailMatch) {
      schoolEmail = bodyEmailMatch[0]
      evidence.push({ field: 'schoolEmail', value: schoolEmail, source: 'email_body' })
    }
  }

  // ── 4. Reason ─────────────────────────────────────────────────────────────────
  let reason: string | undefined
  const reasonPatterns = [
    /原因[：:]\s*([^\n。！?.]{4,80})/,
    /因为([^\n。！?.]{4,60})/,
    /由于([^\n。！?.]{4,60})/,
    /Reason[：:\s]+([^\n.!?]{4,80})/i,
    /(丢失|遗失|损坏|无法使用|lost|damaged|not working)[^。\n]*[。\n]?/i,
  ]
  for (const pat of reasonPatterns) {
    const m = body.match(pat)
    if (m) {
      reason = (m[1] ?? m[0]).trim()
      evidence.push({ field: 'reason', value: reason, source: 'email_body' })
      break
    }
  }

  // ── 5. Intent flags ───────────────────────────────────────────────────────────
  const hasLostStatement = /丢了|遗失|挂失|lost|missing|misplaced/i.test(body)
  const hasReplacementIntent = /补办|重新办理|replacement|replace|reissue/i.test(body)
  const mentionedCampusCard = /校园卡|学生卡|campus card|student card/i.test(body)

  // ── 6. Provided / missing fields ─────────────────────────────────────────────
  const fieldValues: Record<string, string | undefined> = {
    applicantName,
    studentId,
    schoolEmail,
    reason,
  }

  const providedFields: string[] = []
  const missingFields: string[] = []
  for (const key of REQUIRED_FIELDS) {
    if (fieldValues[key]) {
      providedFields.push(FIELD_LABELS[key])
    } else {
      missingFields.push(FIELD_LABELS[key])
    }
  }

  return {
    applicantName,
    studentId,
    schoolEmail,
    reason,
    hasLostStatement,
    hasReplacementIntent,
    mentionedCampusCard,
    providedFields,
    missingFields,
    evidence,
  }
}
