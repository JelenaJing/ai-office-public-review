/**
 * Matrix chat types for Phase 6-A MVP
 */

export interface MatrixSession {
  userId: string
  accessToken: string
  homeserver: string
  deviceId?: string
}

export interface MatrixRoomMember {
  userId: string
  displayName?: string
  membership: 'join' | 'invite' | 'leave' | 'ban'
}

export interface MatrixRoom {
  roomId: string
  /** Explicit room name from m.room.name event; may be empty string */
  name: string
  isDirect: boolean
  directUserId?: string
  /** All known members parsed from m.room.member state events */
  members?: MatrixRoomMember[]
  lastTs: number
  lastMessage?: MatrixMsgEvent
}

export interface MatrixMsgEvent {
  eventId: string
  sender: string
  body: string
  msgtype: string
  timestamp: number
  /** mxc:// URI — present for m.image and m.file */
  url?: string
  /** MIME type from event content.info */
  mimetype?: string
  /** File/image byte size from event content.info */
  size?: number
  /** Image pixel width from event content.info */
  width?: number
  /** Image pixel height from event content.info */
  height?: number
}

export type MatrixChatPhase =
  | 'idle'
  | 'restoring'
  | 'needs_login'
  | 'logging_in'
  | 'logged_in'
  | 'error'
