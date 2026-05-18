/**
 * mockTicketConnector.ts
 *
 * MVP mock connector for service ticket management (open/create).
 * In production, replace with real university helpdesk / ticketing system API.
 */

export interface MockTicket {
  ticketId: string
  studentId: string
  scenarioType: string
  status: 'open' | 'processing' | 'closed' | 'cancelled'
  createdAt: string
  description?: string
}

export interface FindTicketsInput {
  studentId: string
  scenarioType: string
}

export interface CreateTicketInput {
  studentId: string
  scenarioType: string
  subject: string
  description?: string
  sourceEmailId?: string
}

// In-memory mock store (resets on page reload — fine for MVP)
const _mockTicketStore: MockTicket[] = []

/** Returns all open tickets for the given student and scenario type. */
export function findMockOpenTickets(input: FindTicketsInput): MockTicket[] {
  return _mockTicketStore.filter(
    (t) =>
      t.studentId === input.studentId &&
      t.scenarioType === input.scenarioType &&
      t.status === 'open',
  )
}

/** Creates a new mock ticket and stores it in memory. */
export function createMockTicket(input: CreateTicketInput): MockTicket {
  const ticket: MockTicket = {
    ticketId: `TKT-${Date.now()}`,
    studentId: input.studentId,
    scenarioType: input.scenarioType,
    status: 'open',
    createdAt: new Date().toISOString(),
    description: input.description,
  }
  _mockTicketStore.push(ticket)
  return ticket
}
