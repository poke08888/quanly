// OAuth access-token auto-refresh for live shops. TikTok Shop and Shopee access
// tokens expire (Shopee ~4h); a long-lived refresh_token mints a new one. Before any
// live fetch, withFreshToken() refreshes the token if it's missing an expiry or is
// near expiry, persists the rotated tokens (encrypted), and returns the updated shop.
//
// The exact refresh request/response shapes are best-effort (// TODO confirm against
// the real sandboxes) and every failure is NON-FATAL: on error we log and fall back
// to the stored access_token so the subsequent fetch still runs (and surfaces the
// platform's own auth error if that token is also dead).

import { setShopTokens, type ShopRow } from './store/db'
import { publicSign } from './shopee/sign'

// Refresh if the token has no known expiry yet, or expires within this many seconds.
const SKEW_SECONDS = 300

const TIKTOK_AUTH_URL = process.env.TIKTOK_AUTH_URL ?? 'https://auth.tiktok-shops.com'
const SHOPEE_AUTH_PATH = '/api/v2/auth/access_token/get'

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/** Normalize an "expire_in" value to an absolute unix-seconds expiry. */
function toExpiresAt(expire: unknown): number | undefined {
  const n = Number(expire)
  if (!Number.isFinite(n) || n <= 0) return undefined
  // Values > ~1e9 are already absolute epochs; smaller ones are durations from now.
  return n > 1_000_000_000 ? n : nowSec() + n
}

interface RefreshResult {
  accessToken: string
  refreshToken?: string
  tokenExpiresAt?: number
}

/** Exchange a one-time auth_code (from the seller authorization redirect) for tokens. */
export async function exchangeTikTokCode(
  appKey: string,
  appSecret: string,
  authCode: string,
): Promise<RefreshResult> {
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: authCode,
    grant_type: 'authorized_code',
  })
  // TODO confirm exact path/version against the sandbox (/api/v2/token/get).
  const url = `${TIKTOK_AUTH_URL}/api/v2/token/get?${qs.toString()}`
  const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
  const json = (await res.json()) as {
    code?: number
    message?: string
    data?: { access_token?: string; access_token_expire_in?: number; refresh_token?: string }
  }
  if (!res.ok || (json.code != null && json.code !== 0)) {
    throw new Error(`TikTok token exchange code ${json.code}: ${json.message ?? res.status}`)
  }
  const d = json.data ?? {}
  if (!d.access_token) throw new Error('TikTok token exchange: no access_token in response')
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    tokenExpiresAt: toExpiresAt(d.access_token_expire_in),
  }
}

/** TikTok Shop Partner API token refresh (app_key + app_secret + refresh_token). */
async function refreshTikTok(shop: ShopRow): Promise<RefreshResult> {
  const c = shop.credentials
  const qs = new URLSearchParams({
    app_key: c.appKey ?? '',
    app_secret: c.appSecret ?? '',
    refresh_token: c.refreshToken ?? '',
    grant_type: 'refresh_token',
  })
  // TODO confirm exact path/version against the sandbox (/api/v2/token/refresh).
  const url = `${TIKTOK_AUTH_URL}/api/v2/token/refresh?${qs.toString()}`
  const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
  const json = (await res.json()) as {
    code?: number
    message?: string
    data?: {
      access_token?: string
      access_token_expire_in?: number
      refresh_token?: string
    }
  }
  if (!res.ok || (json.code != null && json.code !== 0)) {
    throw new Error(`TikTok token refresh code ${json.code}: ${json.message ?? res.status}`)
  }
  const d = json.data ?? {}
  if (!d.access_token) throw new Error('TikTok token refresh: no access_token in response')
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    tokenExpiresAt: toExpiresAt(d.access_token_expire_in),
  }
}

/** Shopee Open API v2 token refresh (public-signed /auth/access_token/get). */
async function refreshShopee(shop: ShopRow): Promise<RefreshResult> {
  const c = shop.credentials
  const base = c.baseUrl || process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'
  const ts = nowSec()
  const sign = publicSign(c.partnerId ?? '', c.partnerKey ?? '', SHOPEE_AUTH_PATH, ts)
  const qs = new URLSearchParams({ partner_id: String(c.partnerId ?? ''), timestamp: String(ts), sign })
  const url = `${base}${SHOPEE_AUTH_PATH}?${qs.toString()}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // TODO confirm body field names (partner_id/shop_id/refresh_token) vs sandbox.
    body: JSON.stringify({
      refresh_token: c.refreshToken ?? '',
      partner_id: Number(c.partnerId ?? 0),
      shop_id: Number(c.shopId ?? 0),
    }),
  })
  const json = (await res.json()) as {
    error?: string
    message?: string
    access_token?: string
    refresh_token?: string
    expire_in?: number
  }
  if (!res.ok || json.error) {
    throw new Error(`Shopee token refresh error ${json.error}: ${json.message ?? res.status}`)
  }
  if (!json.access_token) throw new Error('Shopee token refresh: no access_token in response')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenExpiresAt: toExpiresAt(json.expire_in),
  }
}

/** True if the shop's access token should be refreshed now. */
function needsRefresh(shop: ShopRow): boolean {
  if (shop.mode !== 'live') return false
  if (!shop.credentials.refreshToken) return false // can't refresh without one
  const exp = shop.credentials.tokenExpiresAt
  return exp == null || nowSec() >= exp - SKEW_SECONDS
}

/**
 * Ensure a live shop has a fresh access token. Refreshes + persists if needed; returns
 * the updated shop (or the original on no-op / non-fatal failure). Never throws.
 */
export async function withFreshToken(shop: ShopRow): Promise<ShopRow> {
  if (!needsRefresh(shop)) return shop
  try {
    const r = shop.platform === 'tiktok' ? await refreshTikTok(shop) : await refreshShopee(shop)
    const updated = setShopTokens(shop.id, r)
    if (updated) {
      console.log(`[oauth] refreshed ${shop.platform} token for shop "${shop.name}" (id=${shop.id})`)
      return updated
    }
    return shop
  } catch (err) {
    console.warn(`[oauth] refresh failed for shop "${shop.name}" (id=${shop.id}):`, (err as Error).message)
    return shop
  }
}

/** Resolve + refresh: map a list of shops through withFreshToken concurrently. */
export async function freshTokens(shops: ShopRow[]): Promise<ShopRow[]> {
  return Promise.all(shops.map(withFreshToken))
}
