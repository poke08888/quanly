// Live TikTok API for Business (Marketing/Reporting API) client. This is a
// DIFFERENT API from the Partner API (server/tiktok/): base host
// business-api.tiktok.com, NO HMAC signing — auth is the `Access-Token` header
// plus an `advertiser_id` query param. Only reached when TIKTOK_MODE=live.

import type { BizCampaignEnvelope, BizReportEnvelope } from './types'

export interface TikTokBizCreds {
  accessToken: string
  advertiserId: string
  baseUrl: string
}

const REPORT_PATH = '/open_api/v1.3/report/integrated/get/'
const CAMPAIGN_PATH = '/open_api/v1.3/campaign/get/'

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString()
  return `${baseUrl}${path}?${qs}`
}

async function getJson<T>(
  creds: TikTokBizCreds,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const query: Record<string, string> = { advertiser_id: creds.advertiserId }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) query[k] = String(v)
  }
  const url = buildUrl(creds.baseUrl, path, query)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Access-Token': creds.accessToken,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok Biz ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as T & { code?: number; message?: string }
  if (json.code != null && json.code !== 0) {
    throw new Error(`TikTok Biz ${path} code ${json.code}: ${json.message}`)
  }
  return json
}

// Metrics we request. TODO confirm exact metric names against the sandbox —
// complete_payment_roas / total_complete_payment are the attributed-ROAS/GMV pair.
const METRICS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'conversion',
  'cost_per_conversion',
  'complete_payment_roas', // TODO confirm
  'total_complete_payment', // TODO confirm (attributed GMV)
]

/** Fetch a paginated integrated report for the given dimensions. */
async function fetchReport(
  creds: TikTokBizCreds,
  dimensions: string[],
  start: string,
  end: string,
): Promise<BizReportEnvelope['data']['list']> {
  const out: BizReportEnvelope['data']['list'] = []
  let page = 1
  let guard = 0
  const pageSize = 100
  for (;;) {
    const env = await getJson<BizReportEnvelope>(creds, REPORT_PATH, {
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN', // TODO confirm for advertiser-daily use AUCTION_ADVERTISER
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify(METRICS),
      start_date: start,
      end_date: end,
      page,
      page_size: pageSize,
    })
    out.push(...(env.data?.list ?? []))
    const info = env.data?.page_info
    guard++
    if (!info || page * pageSize >= (info.total_number ?? 0) || guard >= 100) break
    page++
  }
  return out
}

/** Campaign-level totals over the window (dimensions=["campaign_id"]). */
export function fetchCampaignReport(creds: TikTokBizCreds, start: string, end: string) {
  return fetchReport(creds, ['campaign_id'], start, end)
}

/** Advertiser-level daily spend (dimensions=["stat_time_day"]). */
export function fetchDailyReport(creds: TikTokBizCreds, start: string, end: string) {
  return fetchReport(creds, ['stat_time_day'], start, end)
}

/** campaign_id -> { name, objective } via /campaign/get/ (paginated). */
export async function fetchCampaignMeta(
  creds: TikTokBizCreds,
): Promise<BizCampaignEnvelope['data']['list']> {
  const out: BizCampaignEnvelope['data']['list'] = []
  let page = 1
  let guard = 0
  const pageSize = 100
  for (;;) {
    const env = await getJson<BizCampaignEnvelope>(creds, CAMPAIGN_PATH, {
      page,
      page_size: pageSize,
      // filtering: JSON.stringify({}) // TODO confirm filtering shape if needed
    })
    out.push(...(env.data?.list ?? []))
    const info = env.data?.page_info
    guard++
    if (!info || page * pageSize >= (info.total_number ?? 0) || guard >= 100) break
    page++
  }
  return out
}
