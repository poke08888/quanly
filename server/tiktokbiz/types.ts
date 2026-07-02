// Raw TikTok API for Business (Reporting + Campaign) envelope shapes + the
// server-side Campaign domain mirror. Metric/field names are best-effort; see
// // TODO confirm markers where the sandbox must be checked.

/** One row of the integrated report. dimensions carry the group-by keys. */
export interface BizReportRow {
  dimensions: {
    campaign_id?: string
    stat_time_day?: string // "YYYY-MM-DD" (or "YYYY-MM-DD HH:MM:SS") — sliced to a day
  }
  metrics: Record<string, string | number>
}

export interface BizReportEnvelope {
  code: number
  message: string
  data: {
    list: BizReportRow[]
    page_info?: {
      total_number?: number
      page?: number
      page_size?: number
    }
  }
}

export interface BizCampaignRow {
  campaign_id: string
  campaign_name: string
  objective_type?: string // TODO confirm field name (objective vs objective_type)
}

export interface BizCampaignEnvelope {
  code: number
  message: string
  data: {
    list: BizCampaignRow[]
    page_info?: {
      total_number?: number
      page?: number
      page_size?: number
    }
  }
}

/** Mirror of src/data/types.ts Campaign (kept in sync). */
export interface Campaign {
  id: string
  name: string
  brand: string
  platform: 'tiktok' | 'shopee'
  type: string
  spend: number
  gmv: number
  roas: number
  impressions: number
  ctr: number
  clicks: number
  cpc: number
  cpm: number
  conversions: number
}

/** Per-day ad spend, injected into DailyRow.ads by date. */
export interface DailyAdSpend {
  date: string
  adSpend: number
}
