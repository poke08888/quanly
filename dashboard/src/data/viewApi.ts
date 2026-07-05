// Per-screen consolidated read API. Each screen fetches ONE endpoint that the server
// aggregates directly from SQLite (daily_data / snapshot_data / raw_orders / recon_cache).
// No external TikTok/Shopee calls — the background poller (old server) fills the DB.
import { apiFetch } from './apiBase'
import type {
  Aggregate,
  Campaign,
  Creator,
  DailyRow,
  PlatformFilter,
  ProductPerf,
  ReconOrder,
} from './types'
import type { KpiPeriod } from '../lib/kpiProgress'

export interface OrdersRequest {
  platform: PlatformFilter
  brand: string
  status: 'all' | 'settled' | 'pending'
  q: string
  sortKey: string
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface OrdersPage {
  rows: ReconOrder[]
  total: number
  totals: { gmv: number; fee: number; net: number }
}

/** m7 — one page of orders (server filters/sorts/paginates over recon in SQLite). */
export function fetchOrders(req: OrdersRequest): Promise<OrdersPage> {
  return apiFetch('/api/view/orders', { method: 'POST', body: JSON.stringify(req) })
}

/** A concrete date window [start, end] (inclusive, YYYY-MM-DD). */
export interface Win {
  start: string
  end: string
}

const enc = encodeURIComponent

/** One REAL intraday point (hour-over-hour delta from the poller's cumulative snapshots). */
export interface HourPoint {
  hour: number
  gmv: number
  cost: number
  profit: number
}

export interface OverviewPayload {
  cur: Aggregate
  prev: Aggregate
  /** true = prev là hôm qua cắt đúng giờ-phút hiện tại (kỳ Hôm nay). */
  prevAligned?: boolean
  tkAgg: Aggregate
  spAgg: Aggregate
  series: DailyRow[]
  /** Non-empty only when the period is a single day AND hourly snapshots exist. */
  hourly: HourPoint[]
  campaigns: Campaign[]
  topProducts: ProductPerf[]
  kpiActuals: Record<KpiPeriod, number>
}

export interface OverviewRequest {
  platform: PlatformFilter
  brand: string
  cur: Win
  prev: Win
  series: Win
  daily: Win
  monthly: Win
  quarterly: Win
  yearly: Win
}

/** m1 — everything the executive overview renders, in one aggregation pass. */
export function fetchOverview(req: OverviewRequest): Promise<OverviewPayload> {
  return apiFetch('/api/view/overview', { method: 'POST', body: JSON.stringify(req) })
}

/** Tổng ads kỳ trước — Hôm nay so với hôm qua CẮT đúng giờ-phút hiện tại. */
export interface AdsCompare {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  gmv: number
  aligned: boolean
  est: boolean
}

/** m3 — ads campaigns over the window + kỳ trước để so sánh. */
export function fetchAds(
  platform: PlatformFilter,
  brand: string,
  w: Win,
): Promise<{ campaigns: Campaign[]; adsCompare: AdsCompare | null }> {
  return apiFetch(`/api/view/ads?platform=${platform}&brand=${enc(brand)}&start=${w.start}&end=${w.end}`)
}

/** m4 — KOC/creators + the cur aggregate (GMV-share denominator). */
export function fetchKoc(
  platform: PlatformFilter,
  brand: string,
  w: Win,
): Promise<{ creators: Creator[]; cur: Aggregate }> {
  return apiFetch(`/api/view/koc?platform=${platform}&brand=${enc(brand)}&start=${w.start}&end=${w.end}`)
}

/** m6 + m7 — reconciliation orders (server uses a 30-day rolling window). */
export function fetchRecon(platform: PlatformFilter, brand: string): Promise<{ reconOrders: ReconOrder[] }> {
  return apiFetch(`/api/view/recon?platform=${platform}&brand=${enc(brand)}`)
}

/** m9 — actual GMV to-date per KPI period (respects platform/brand filter). */
export function fetchKpiActuals(input: {
  platform: PlatformFilter
  brand: string
  daily: Win
  monthly: Win
  quarterly: Win
  yearly: Win
}): Promise<{ kpiActuals: Record<KpiPeriod, number> }> {
  return apiFetch('/api/view/kpi-actuals', { method: 'POST', body: JSON.stringify(input) })
}
