// Normalization for TikTok API for Business reports. SHARED by sample + live so
// sample fixtures exercise the real code path (not a shortcut).

import type {
  BizCampaignRow,
  BizReportRow,
  Campaign,
  DailyAdSpend,
} from './types'

function num(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Read a metric by any of several candidate keys (best-effort naming). */
function metric(m: Record<string, string | number>, ...keys: string[]): number {
  for (const k of keys) {
    if (m[k] != null && m[k] !== '') return num(m[k])
  }
  return 0
}

function sliceDay(s: string | undefined): string {
  const str = String(s ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : str
}

/**
 * Build Campaign[] from the campaign-level report rows + a campaign_id -> meta
 * map (name, objective). All numbers derived from the report metrics.
 *   cpm  = metric if present else spend/impressions*1000
 *   roas = complete_payment_roas if present else gmv/spend
 *   gmv  = total_complete_payment (attributed) if present else spend*roas
 */
export function normalizeCampaigns(
  reportRows: BizReportRow[],
  meta: Map<string, BizCampaignRow>,
  brand: string,
): Campaign[] {
  const out: Campaign[] = []
  for (const row of reportRows) {
    const id = String(row.dimensions.campaign_id ?? '')
    if (!id) continue
    const m = row.metrics

    const spend = metric(m, 'spend', 'cost') // TODO confirm 'spend'
    const impressions = metric(m, 'impressions', 'show_cnt') // TODO confirm
    const clicks = metric(m, 'clicks', 'click_cnt') // TODO confirm
    const ctr = m.ctr != null ? num(m.ctr) / 100 : impressions ? clicks / impressions : 0 // TODO confirm ctr is percent
    const cpc = m.cpc != null ? num(m.cpc) : clicks ? spend / clicks : 0
    const cpm = m.cpm != null ? num(m.cpm) : impressions ? (spend / impressions) * 1000 : 0

    // ROAS: prefer complete_payment_roas; else derive from gmv/spend.
    const roasMetric = metric(m, 'complete_payment_roas', 'complete_payment_rate_roas') // TODO confirm
    // Attributed GMV: prefer total_complete_payment; else spend*roas.
    const gmvMetric = metric(m, 'total_complete_payment', 'complete_payment', 'gross_revenue') // TODO confirm
    const roas = roasMetric || (spend ? gmvMetric / spend : 0)
    const gmv = gmvMetric || spend * roas
    const conversions = metric(m, 'conversion', 'conversions', 'convert_cnt') // TODO confirm

    const info = meta.get(id)
    out.push({
      id,
      name: info?.campaign_name ?? id,
      brand, // TODO no brand dim in the report; caller-scoped brand is stamped here
      platform: 'tiktok',
      // Campaign.type carries the objective (no separate objective field in the type).
      type: info?.objective_type ?? 'UNKNOWN', // TODO confirm objective_type
      spend,
      gmv,
      roas,
      impressions,
      ctr,
      clicks,
      cpc,
      cpm,
      conversions,
    })
  }
  return out.sort((a, b) => b.spend - a.spend)
}

/** Daily advertiser-level spend rows -> {date, adSpend}[] (summed per day). */
export function normalizeDailySpend(reportRows: BizReportRow[]): DailyAdSpend[] {
  const byDay = new Map<string, number>()
  for (const row of reportRows) {
    const day = sliceDay(row.dimensions.stat_time_day)
    if (!day) continue
    const spend = metric(row.metrics, 'spend', 'cost')
    byDay.set(day, (byDay.get(day) ?? 0) + spend)
  }
  return [...byDay.entries()]
    .map(([date, adSpend]) => ({ date, adSpend }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}
