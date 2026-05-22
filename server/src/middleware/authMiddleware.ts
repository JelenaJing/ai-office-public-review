import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthRequest extends Request {
  userId?: string
}

/** Express middleware that validates a Bearer JWT and attaches userId to req. */
export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ message: '未授权' })
    return
  }
  const token = auth.slice(7)
  try {
    const secret = process.env.JWT_SECRET ?? ''
    const payload = jwt.verify(token, secret) as { userId: string }
    req.userId = payload.userId
    next()
  } catch {
    res.status(401).json({ message: 'token 无效或已过期' })
  }
}
