// User-management store client (view permissions by platform + channel), persisted
// in the BFF. Mirrors costStore.ts. Internal data — not a PlatformConnector.

// Same-origin: dev Vite proxies /api → read-API; prod the API serves the web too.
const BFF_URL = import.meta.env.VITE_API_URL ?? ''

export type UserRole = 'ceo' | 'bm' | 'ops'
export type UserPlatform = 'tiktok' | 'shopee'
export type UserChannel = 'live' | 'video' | 'card' | 'search'

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  /** Sàn the user may view. */
  platforms: UserPlatform[]
  /** GMV channels/sources the user may view. */
  channels: UserChannel[]
  active: boolean
  /** True if a login password has been set. The hash never reaches the browser. */
  hasPassword?: boolean
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BFF_URL}${path}`)
  if (!res.ok) throw new Error(`user-store ${path} ${res.status}`)
  return (await res.json()) as T
}

export async function fetchUsers(): Promise<User[]> {
  // Resilient read: degrade to empty if the BFF is unreachable so the app load
  // (Promise.all in useDashboard) never hangs on a down BFF.
  try {
    return await getJson<User[]>('/api/users')
  } catch {
    return []
  }
}

/** Update one user by id (partial patch: role/platforms/channels/active/name/email). */
export async function upsertUser(id: number, patch: Partial<Omit<User, 'id'>>): Promise<User> {
  const res = await fetch(`${BFF_URL}/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`user-store PUT ${res.status}`)
  return (await res.json()) as User
}

export async function addUser(input: {
  name: string
  email: string
  role: UserRole
  platforms?: UserPlatform[]
  channels?: UserChannel[]
  active?: boolean
}): Promise<User> {
  const res = await fetch(`${BFF_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`user-store POST ${res.status}`)
  return (await res.json()) as User
}

export async function deleteUser(id: number): Promise<void> {
  await fetch(`${BFF_URL}/api/users/${id}`, { method: 'DELETE' })
}

/** Set/reset a user's login password (prototype). Throws on failure so the UI can
 *  surface an error; the server stores only a hash and never returns it. */
export async function setUserPassword(id: number, password: string): Promise<void> {
  const res = await fetch(`${BFF_URL}/api/users/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`user-store PUT password ${res.status}`)
}
