// Live TikTok Shop Partner API v2 client for product performance + order search.
// Reuses the SAME HMAC signing (sign.ts) + TikTok Shop creds + base host. Field
// names/paths are best-effort (// TODO confirm). Only reached when TIKTOK_MODE=live.

import { signedQuery } from './sign'
import { limit } from '../limiter'
import type { TikTokCreds } from './client'
import type { OrderSearchEnvelope, SearchedOrder, ShopProduct, ShopProductsEnvelope } from './types'

const SHOP_PRODUCTS_PATH = '/analytics/202405/shop_products/performance'
const ORDER_SEARCH_PATH = '/order/202309/orders/search'

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  return `${baseUrl}${path}?${new URLSearchParams(query).toString()}`
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
  return limit(async () => {
    const res = await fetch(buildUrl(creds.baseUrl, path, query), {
      method: 'GET',
      headers: { 'x-tts-access-token': creds.accessToken, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`TikTok ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as T & { code?: number; message?: string }
    if (json.code != null && json.code !== 0) {
      throw new Error(`TikTok ${path} code ${json.code}: ${json.message}`)
    }
    return json
  })
}

export async function fetchShopProducts(
  creds: TikTokCreds,
  start: string,
  end: string,
): Promise<ShopProduct[]> {
  const env = await getSigned<ShopProductsEnvelope>(creds, SHOP_PRODUCTS_PATH, {
    start_date_ge: start,
    end_date_lt: end, // API requires end_date_lt (same as shop/performance)
    granularity: 'ALL',
  })
  return env.data?.products ?? []
}

/** POST with a signed JSON body (order search is POST, not GET). */
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
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`TikTok ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as T & { code?: number; message?: string }
    if (json.code != null && json.code !== 0) {
      throw new Error(`TikTok ${path} code ${json.code}: ${json.message}`)
    }
    return json
  })
}

export async function fetchOrderSearch(
  creds: TikTokCreds,
  start: string,
  end: string,
): Promise<OrderSearchEnvelope> {
  // Order search is POST: time window (unix seconds) goes in the JSON body; paging in query.
  const geSec = Math.floor(Date.parse(start + 'T00:00:00Z') / 1000) - 7 * 3600
  const ltSec = Math.floor(Date.parse(end + 'T00:00:00Z') / 1000) - 7 * 3600
  const all: SearchedOrder[] = []
  let pageToken: string | undefined
  let guard = 0
  let last: OrderSearchEnvelope | undefined
  do {
    const env = await postSigned<OrderSearchEnvelope>(
      creds,
      ORDER_SEARCH_PATH,
      { page_size: 50, page_token: pageToken, sort_field: 'create_time' },
      { create_time_ge: geSec, create_time_lt: ltSec },
    )
    last = env
    all.push(...(env.data?.orders ?? []))
    pageToken = env.data?.next_page_token || undefined
    guard++
  } while (pageToken && guard < 100)
  return { code: last?.code ?? 0, message: last?.message ?? 'ok', data: { orders: all } }
}
