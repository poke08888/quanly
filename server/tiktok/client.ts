// Live TikTok Partner API v2 client. Signs (via sign.ts) and calls the real
// Analytics + Finance endpoints server-side, then hands the raw envelopes to the
// SAME normalize.ts used by sample mode. Only reached when TIKTOK_MODE=live.

import { signedQuery } from './sign'
import type { AnalyticsEnvelope, FinanceEnvelope, FinanceStatement } from './types'

export interface TikTokCreds {
  appKey: string
  appSecret: string
  accessToken: string
  shopCipher: string
  baseUrl: string
}

const ANALYTICS_PATH = '/analytics/202405/shop/performance'
const FINANCE_PATH = '/finance/202309/statements'

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
    throw new Error(`TikTok ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as T & { code?: number; message?: string }
  if (json.code != null && json.code !== 0) {
    throw new Error(`TikTok ${path} code ${json.code}: ${json.message}`)
  }
  return json
}

export async function fetchAnalytics(
  creds: TikTokCreds,
  start: string,
  end: string,
): Promise<AnalyticsEnvelope> {
  // TODO confirm exact param names against the sandbox. The v2 analytics endpoints
  // use a granularity + date-range window; names below are best-effort.
  return getSigned<AnalyticsEnvelope>(creds, ANALYTICS_PATH, {
    granularity: 'DAY', // TODO confirm: '1D' vs 'DAY' vs 'DAILY'
    start_date_ge: start, // inclusive lower bound (YYYY-MM-DD)
    start_date_lt: end, // exclusive upper bound (YYYY-MM-DD)
  })
}

export async function fetchFinanceStatements(
  creds: TikTokCreds,
  start: string,
  end: string,
): Promise<FinanceEnvelope> {
  // Paginate until next_page_token is empty. Param names best-effort.
  const all: FinanceStatement[] = []
  let pageToken: string | undefined
  let guard = 0
  let last: FinanceEnvelope | undefined
  do {
    const page = await getSigned<FinanceEnvelope>(creds, FINANCE_PATH, {
      // TODO confirm param names: statement time window + page size.
      statement_time_ge: start,
      statement_time_lt: end,
      page_size: 50,
      page_token: pageToken,
      sort_field: 'statement_time',
    })
    last = page
    all.push(...(page.data?.statements ?? []))
    pageToken = page.data?.next_page_token || undefined
    guard++
  } while (pageToken && guard < 100)

  return {
    code: last?.code ?? 0,
    message: last?.message ?? 'ok',
    data: { statements: all },
  }
}
