// Live Shopee Open API v2 ads-module client. Reuses the SAME shop-level signing
// (sign.ts) and SHOPEE_* creds as the order/escrow client — the ads module just
// needs Shopee to grant ads permission on the shop (// TODO). Only reached when
// SHOPEE_MODE=live.

import { signedCommon } from './sign'
import type { ShopeeCreds } from './client'
import type { AdsCampaignRow, AdsDailyRow } from './types'

const ADS_DAILY_PATH = '/api/v2/ads/get_all_cpc_ads_daily_performance'
const ADS_CAMPAIGN_PATH = '/api/v2/ads/get_product_campaign_daily_performance'

/** Shopee ads endpoints expect dates as dd-mm-yyyy. TODO confirm format. */
function ddmmyyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y}`
}

function buildUrl(creds: ShopeeCreds, path: string, extra: Record<string, string>): string {
  const common = signedCommon(
    creds.partnerId,
    creds.partnerKey,
    path,
    creds.accessToken,
    creds.shopId,
  )
  const qs = new URLSearchParams({ ...common, ...extra }).toString()
  return `${creds.baseUrl}${path}?${qs}`
}

// Shopee's ads module rate-limits HARD (429s even at modest volume). All ads calls go
// through ONE serialized queue with spacing, and 429s retry with backoff inside the
// queue (so later calls wait instead of piling on).
const ADS_GAP_MS = 1200
let adsChain: Promise<unknown> = Promise.resolve()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = adsChain.then(fn, fn).finally(() => sleep(ADS_GAP_MS))
  adsChain = next.catch(() => undefined) // keep the chain alive after failures
  return next
}

async function get<T>(creds: ShopeeCreds, path: string, extra: Record<string, string>): Promise<T> {
  return throttled(async () => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(buildUrl(creds, path, extra), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 429 && attempt <= 3) {
        await sleep(attempt * 4000) // 4s / 8s / 12s backoff, inside the queue
        continue
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Shopee ads ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
      }
      const json = (await res.json()) as T & { error?: string; message?: string }
      if (json.error) throw new Error(`Shopee ads ${path} error ${json.error}: ${json.message}`)
      return json
    }
  })
}

/** Shop-level daily CPC ads performance. start/end are YYYY-MM-DD.
 *  VERIFIED against the live API: `response` is a BARE ARRAY of daily rows
 *  ({date: 'dd-mm-yyyy', expense, impression, clicks, broad_gmv, ...}) — the old
 *  `response.daily_performance_list` read matched nothing, so ad spend was never
 *  ingested despite HTTP 200s. Keep the object shape as a defensive fallback. */
export async function fetchAdsDaily(
  creds: ShopeeCreds,
  start: string,
  end: string,
): Promise<AdsDailyRow[]> {
  const env = await get<{ response: AdsDailyRow[] | { daily_performance_list?: AdsDailyRow[] } }>(
    creds,
    ADS_DAILY_PATH,
    { start_date: ddmmyyyy(start), end_date: ddmmyyyy(end) },
  )
  const resp = env.response
  return Array.isArray(resp) ? resp : resp?.daily_performance_list ?? []
}

const ADS_ID_LIST_PATH = '/api/v2/ads/get_product_level_campaign_id_list'
const ADS_SETTING_PATH = '/api/v2/ads/get_product_level_campaign_setting_info'

/** Enumerate ALL product-level campaign ids (paginated by offset; VERIFIED shape:
 *  response.{has_next_page, campaign_list:[{ad_type, campaign_id}]}). */
export async function fetchCampaignIds(creds: ShopeeCreds): Promise<string[]> {
  const ids: string[] = []
  const LIMIT = 100
  for (let page = 0; page < 40; page++) {
    const env = await get<{
      response?: { has_next_page?: boolean; campaign_list?: Array<{ campaign_id?: number | string }> }
    }>(creds, ADS_ID_LIST_PATH, { offset: String(page * LIMIT), limit: String(LIMIT) })
    for (const c of env.response?.campaign_list ?? []) {
      if (c.campaign_id != null) ids.push(String(c.campaign_id))
    }
    if (!env.response?.has_next_page) break
  }
  return ids
}

/** Campaign names + status (VERIFIED shape: response.campaign_list[].common_info.ad_name). */
export async function fetchCampaignNames(
  creds: ShopeeCreds,
  campaignIds: string[],
): Promise<Map<string, { name?: string; status?: string }>> {
  const out = new Map<string, { name?: string; status?: string }>()
  for (let i = 0; i < campaignIds.length; i += 100) {
    const batch = campaignIds.slice(i, i + 100)
    const env = await get<{
      response?: {
        campaign_list?: Array<{
          campaign_id?: number | string
          common_info?: { ad_name?: string; campaign_status?: string }
        }>
      }
    }>(creds, ADS_SETTING_PATH, { info_type_list: '1', campaign_id_list: batch.join(',') })
    for (const c of env.response?.campaign_list ?? []) {
      if (c.campaign_id != null)
        out.set(String(c.campaign_id), { name: c.common_info?.ad_name, status: c.common_info?.campaign_status })
    }
  }
  return out
}

/**
 * Campaign-level CPC daily performance. VERIFIED shape: the payload is NESTED —
 * response.campaign_list[] = { campaign_id, metrics_list:[{date, expense, ...}] } —
 * so we flatten each metrics row tagged with its campaign_id. Batched ≤50 ids/call;
 * callers should keep the date range ≤1 month (API limit).
 */
export async function fetchAdsCampaigns(
  creds: ShopeeCreds,
  start: string,
  end: string,
  campaignIds: string[],
): Promise<AdsCampaignRow[]> {
  if (campaignIds.length === 0) return []
  const rows: AdsCampaignRow[] = []
  for (let i = 0; i < campaignIds.length; i += 50) {
    const batch = campaignIds.slice(i, i + 50)
    const env = await get<{
      response?: {
        campaign_list?: Array<{
          campaign_id?: number | string
          metrics_list?: Array<Record<string, unknown>>
        }>
      }
    }>(creds, ADS_CAMPAIGN_PATH, {
      start_date: ddmmyyyy(start),
      end_date: ddmmyyyy(end),
      campaign_id_list: batch.join(','),
    })
    const list = env.response?.campaign_list ?? []
    list.forEach((c, idx) => {
      const id = c.campaign_id != null ? String(c.campaign_id) : batch[idx]
      for (const m of c.metrics_list ?? []) {
        rows.push({ ...(m as AdsCampaignRow), campaign_id: id })
      }
    })
  }
  return rows
}
