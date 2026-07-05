// Live TikTok Shop Affiliate Seller API client. Reuses the SAME Partner API v2
// HMAC signing (sign.ts) + TikTok Shop creds (TikTokCreds) + base host.
//
// Endpoint verified against the live API (2026-07-05 probe from production):
//   POST /affiliate_seller/202410/orders/search   ← version 202410 accepted
//   (202405/202406/202409 → "Invalid API version"; with missing scope the call
//   returns code 105005 "Access denied" — the app needs the Affiliate Seller
//   scope granted in Partner Center + shop re-authorization before data flows.)
// Response field names are not verifiable until the scope is granted, so the
// caller (normalizeCreators) extracts them defensively and we log the first
// order's keys ONCE on the first successful page (shape discovery in prod log).

import { signedQuery } from './sign'
import { limit } from '../limiter'
import type { TikTokCreds } from './client'
import type { AffiliateOrder, AffiliateOrdersEnvelope } from './types'

const AFFILIATE_ORDERS_PATH = '/affiliate_seller/202410/orders/search'

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  return `${baseUrl}${path}?${new URLSearchParams(query).toString()}`
}

async function postSigned<T>(
  creds: TikTokCreds,
  path: string,
  params: Record<string, string | number | undefined>,
  bodyObj: unknown,
): Promise<T> {
  const body = JSON.stringify(bodyObj)
  const query = signedQuery(
    creds.appSecret,
    path,
    { app_key: creds.appKey, shop_cipher: creds.shopCipher, ...params },
    body,
  )
  return limit(async () => {
    const res = await fetch(buildUrl(creds.baseUrl, path, query), {
      method: 'POST',
      headers: { 'x-tts-access-token': creds.accessToken, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`TikTok affiliate ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as T & { code?: number; message?: string }
    if (json.code != null && json.code !== 0) {
      throw new Error(`TikTok affiliate ${path} code ${json.code}: ${json.message}`)
    }
    return json
  })
}

let shapeLogged = false

/** Fetch ALL affiliate orders (paginated); callers filter by time as needed.
 *  The search body is kept empty on purpose: filter field names can't be
 *  validated until the affiliate scope is granted, and an unknown body field
 *  would 400 the whole call. Pagination is server-driven via page_token. */
export async function fetchAffiliateOrders(
  creds: TikTokCreds,
  _start: string,
  _end: string,
): Promise<AffiliateOrder[]> {
  const all: AffiliateOrder[] = []
  let pageToken: string | undefined
  let guard = 0
  do {
    const env = await postSigned<AffiliateOrdersEnvelope>(
      creds,
      AFFILIATE_ORDERS_PATH,
      { page_size: 50, page_token: pageToken },
      {},
    )
    const d = (env.data ?? {}) as Record<string, unknown>
    const orders = (d.orders ?? d.affiliate_orders ?? d.order_list ?? []) as AffiliateOrder[]
    if (!shapeLogged && orders.length > 0) {
      shapeLogged = true
      console.log(
        `[affiliate] shape discovery — data keys: ${Object.keys(d).join(',')} | ` +
          `order[0] keys: ${Object.keys(orders[0]).join(',')}`,
      )
    }
    all.push(...orders)
    pageToken = (d.next_page_token as string | undefined) || undefined
    guard++
  } while (pageToken && guard < 200)
  return all
}
