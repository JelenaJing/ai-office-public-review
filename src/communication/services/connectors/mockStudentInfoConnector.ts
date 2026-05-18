/**
 * mockStudentInfoConnector.ts
 *
 * MVP mock connector for student identity lookup.
 * In production, replace with real university student information system API.
 */

export interface MockStudentInfo {
  studentId: string
  name: string
  email: string
  program: string
  status: 'active' | 'inactive' | 'graduated'
  faculty: string
}

const CUHKSZ_EMAIL_PATTERNS = [
  'cuhk.edu.cn',
  'cuhksz.edu.cn',
  'link.cuhk.edu.cn',
  'cuhk.edu.hk',
  '@stu.',
]

/** Returns a mock student record if the email looks like a CUHK-SZ student/staff address. */
export function getMockStudentByEmail(email: string): MockStudentInfo | null {
  if (!email) return null
  const lower = email.toLowerCase()
  if (!CUHKSZ_EMAIL_PATTERNS.some((p) => lower.includes(p))) return null
  const localPart = lower.split('@')[0] ?? 'unknown'
  return {
    studentId: `STU-${localPart.replace(/[^a-z0-9]/g, '').slice(0, 8).toUpperCase()}`,
    name: localPart,
    email,
    program: 'MSc Computer Science',
    status: 'active',
    faculty: 'School of Science and Engineering',
  }
}
