import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { platformApi } from '../../platform'

/** Redirects unauthenticated users to /login. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const token = platformApi.auth.getToken()
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
