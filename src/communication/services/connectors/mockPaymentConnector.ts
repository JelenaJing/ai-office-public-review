/**
 * mockPaymentConnector.ts
 *
 * MVP mock connector for checking payment status for campus services.
 * In production, replace with real university payment/finance system API.
 */

export interface MockPaymentStatus {
  studentId: string
  serviceType: string
  status: 'paid' | 'unpaid' | 'waived' | 'not_applicable'
  amount?: number
  paidAt?: string
}

/** Returns mock payment status for a given student and service type. MVP always returns paid. */
export function getMockPaymentStatus(
  studentId: string,
  serviceType: string,
): MockPaymentStatus {
  return {
    studentId,
    serviceType,
    status: 'paid',
    amount: 20,
    paidAt: new Date().toISOString(),
  }
}
