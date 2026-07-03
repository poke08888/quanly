// Session auth client (same-origin cookie nl_sid). The API validates the signed
// cookie; these three calls drive the login gate in useDashboard.
import { API_URL } from './apiBase'
import type { UserRole } from './userStore'

export interface AuthUser {
  id: number
  name: string
  email: string
  role: UserRole
}

/** Current session user, or null when not logged in. Never throws on 401. */
export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
  if (!res.ok) return null
  const json = (await res.json()) as { user?: AuthUser | null } | AuthUser | null
  if (!json) return null
  return 'user' in (json as object) ? ((json as { user?: AuthUser | null }).user ?? null) : (json as AuthUser)
}

/** Log in; returns the user on success or throws with a message on failure. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; user?: AuthUser; error?: string }
  if (!res.ok || !json.ok || !json.user) throw new Error(json.error || 'Email hoặc mật khẩu không đúng.')
  return json.user
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
}
