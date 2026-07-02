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

async function get<T>(creds: ShopeeCreds, path: string, extra: Record<string, string>): Promise<T> {
  const res = await fetch(buildUrl(creds, path, extra), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shopee ads ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as T & { error?: string; message?: string }
  if (json.error) throw new Error(`Shopee ads ${path} error ${json.error}: ${json.message}`)
  return json
}

/** Shop-level daily CPC ads performance. start/end are YYYY-MM-DD. */
export async function fetchAdsDaily(
  creds: ShopeeCreds,
  start: string,
  end: string,
): Promise<AdsDailyRow[]> {
  const env = await get<{ response: { daily_performance_list: AdsDailyRow[] } }>(
    creds,
    ADS_DAILY_PATH,
    { start_date: ddmmyyyy(start), end_date: ddmmyyyy(end) }, // TODO confirm param names/format
  )
  return env.response?.daily_performance_list ?? []
}

/**
 * Campaign-level CPC performance. Requires a campaign_id_list; the id source is
 * account-specific (get_product_campaign_setting_info or an internal list).
 * TODO confirm how to enumerate campaign ids + fetch names.
 */
export async function fetchAdsCampaigns(
  creds: ShopeeCreds,
  start: string,
  end: string,
  campaignIds: string[],
): Promise<AdsCampaignRow[]> {
  if (campaignIds.length === 0) return []
  const env = await get<{ response: { campaign_list?: AdsCampaignRow[]; list?: AdsCampaignRow[] } }>(
    creds,
    ADS_CAMPAIGN_PATH,
    {
      start_date: ddmmyyyy(start),
      end_date: ddmmyyyy(end),
      campaign_id_list: JSON.stringify(campaignIds.map((id) => Number(id))), // TODO confirm shape
    },
  )
  return env.response?.campaign_list ?? env.response?.list ?? []
}
