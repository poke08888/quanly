// Signed-cookie session (HMAC-SHA256 over APP_SECRET_KEY) — same scheme/cookie name as
// the old server so cookies interoperate, but `secure` is gated so local http dev works.
import crypto from 'node:crypto'
import { parse as parseCookies } from 'cookie'
import type { Request, Response, NextFunction } from 'express'
import { getUser } from './store'

const COOKIE = 'nl_sid'
const secret = process.env.APP_SECRET_KEY ?? 'dev-only-insecure'
const SECURE = process.env.NODE_ENV === 'production'

function sign(val: string): string {
  const mac = crypto.createHmac('sha256', secret).update(val).digest('base64url')
  return `${val}.${mac}`
}

function verify(signed: string): string | null {
  const dot = signed.lastIndexOf('.')
  if (dot < 0) return null
  const val = signed.slice(0, dot)
  const expected = sign(val)
  if (Buffer.byteLength(signed, 'utf8') !== Buffer.byteLength(expected, 'utf8')) return null
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signed, 'utf8'), Buffer.from(expected, 'utf8'))) return null
  } catch {
    return null
  }
  return val
}

export function setSession(res: Response, userId: number): void {
  res.cookie(COOKIE, sign(String(userId)), {
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, { path: '/' })
}

export function getSessionUserId(req: Request): number | null {
  const cookies = parseCookies(req.headers.cookie ?? '')
  const signed = cookies[COOKIE]
  if (!signed) return null
  const val = verify(signed)
  if (!val) return null
  const id = Number(val)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Express middleware: 401 unless a valid active session cookie is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const id = getSessionUserId(req)
  if (id !== null && getUser(id)?.active) {
    next()
    return
  }
  res.status(401).json({ error: 'Chưa đăng nhập' })
}
