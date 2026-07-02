// Live TikTok Shop Affiliate Seller API client. Reuses the SAME Partner API v2
// HMAC signing (sign.ts) + TikTok Shop creds (TikTokCreds) + base host. The
// affiliate-seller endpoints are NOT fully public — paths/params/fields below are
// best-effort and marked // TODO confirm. Only reached when TIKTOK_MODE=live.

import { signedQuery } from './sign'
import type { TikTokCreds } from './client'
import type { AffiliateOrder, AffiliateOrdersEnvelope } from './types'

// TODO confirm exact path + version (may be /affiliate_creator/... instead).
const AFFILIATE_ORDERS_PATH = '/affiliate_seller/202405/orders'

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString()
  return `${baseUrl}${path}?${qs}`
}

async function getSigned<T>(
  creds: TikTokCreds,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const query = signedQuery(creds.appSecret, path, {
    app_key: creds.appKey,
    shop_cipher: creds.shopCipher,
    ...params,
  })
  const url = buildUrl(creds.baseUrl, path, query)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-tts-access-token': creds.accessToken,
      'Content-Type': 'application/json',
    },
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
}

/** Fetch affiliate orders in [start,end] (YYYY-MM-DD), paginated. */
export async function fetchAffiliateOrders(
  creds: TikTokCreds,
  start: string,
  end: string,
): Promise<AffiliateOrder[]> {
  const all: AffiliateOrder[] = []
  let pageToken: string | undefined
  let guard = 0
  do {
    const env = await getSigned<AffiliateOrdersEnvelope>(creds, AFFILIATE_ORDERS_PATH, {
      // TODO confirm param names: date window + page size/token.
      start_date_ge: start,
      start_date_lt: end,
      page_size: 100,
      page_token: pageToken,
    })
    all.push(...(env.data?.orders ?? []))
    pageToken = env.data?.next_page_token || undefined
    guard++
  } while (pageToken && guard < 100)
  return all
}
