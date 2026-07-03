// Single API base for the whole app. Empty string = same origin: in dev Vite proxies
// /api → the read-API (see vite.config.ts), in prod the API serves the built web too.
// Because it's same-origin, the session cookie (nl_sid) is sent automatically — no CORS.
export const API_URL = import.meta.env.VITE_API_URL ?? ''

/** fetch() with JSON + credentials; throws on non-2xx, surfaces 401 as a typed error. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (res.status === 401) throw new ApiAuthError()
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${path} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** Thrown on HTTP 401 so the app can show the login gate. */
export class ApiAuthError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'ApiAuthError'
  }
}
