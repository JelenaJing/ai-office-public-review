/**
 * mockCampusCardConnector.ts
 *
 * MVP mock connector for campus card status queries and replacement submissions.
 * In production, replace with real university campus card management system API.
 */

export interface MockCampusCardStatus {
  studentId: string
  cardNumber: string
  status: 'active' | 'lost' | 'suspended' | 'expired'
  balance: number
  lastUsed: string
}

export interface CampusCardReplacementInput {
  studentId: string
  name: string
  reason: string
  contactEmail: string
}

export interface CampusCardReplacementResult {
  ticketId: string
  studentId: string
  status: 'submitted' | 'processing' | 'completed' | 'failed'
  estimatedReadyDate: string
  message: string
}

/** Returns a mock campus card record for the given student ID. */
export function getMockCampusCardStatus(studentId: string): MockCampusCardStatus {
  return {
    studentId,
    cardNumber: `CC-${studentId.slice(-6)}`,
    status: 'lost',
    balance: 0,
    lastUsed: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  }
}

/** Submits a mock campus card replacement request. */
export function submitMockCampusCardReplacement(
  input: CampusCardReplacementInput,
): CampusCardReplacementResult {
  return {
    ticketId: `CARD-${Date.now()}`,
    studentId: input.studentId,
    status: 'submitted',
    estimatedReadyDate: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    message: '校园卡补办申请已提交，预计 5 个工作日内可领取。',
  }
}
