// Normalization: TikTok raw envelopes -> domain DailyRow[]. This is the SINGLE
// code path used by BOTH sample mode (fixtures) and live mode (real API), so
// sample mode exercises the real normalization logic, not a shortcut.

import type {
  AffiliateOrder,
  AnalyticsEnvelope,
  AnalyticsInterval,
  Creator,
  DailyRow,
  Fees,
  FinanceEnvelope,
  FinanceStatement,
  OrderSearchEnvelope,
  ProductPerf,
  ReconOrder,
  SearchedOrder,
  ShopProduct,
} from './types'
import { FEE_KEYS } from './types'

/** Catalog lookup the P&L-aware normalizers need (from the cost store). */
export interface CatalogEntry {
  brand: string
  name: string
  price: number
  unitCost: number
}
export type Catalog = Map<string, CatalogEntry>

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function blankFees(): Fees {
  const f = {} as Fees
  FEE_KEYS.forEach((k) => (f[k] = 0))
  return f
}

/**
 * Best-effort mapping of a TikTok finance statement's fee fields into the domain
 * `Fees` bucket. TikTok's statement fee field names are NOT fully public, so each
 * mapping tries several candidate keys and defaults to 0 when absent.
 * Confirm every `// TODO confirm field name` against the real sandbox response.
 */
export function normalizeFees(st: FinanceStatement): Fees {
  const fees = blankFees()
  const pick = (...candidates: string[]): number => {
    for (const c of candidates) {
      const v = (st as Record<string, unknown>)[c]
      if (v != null && v !== '') return Math.abs(num(v))
    }
    return 0
  }

  // TODO confirm field name: platform commission fee.
  fees.commission_fee = pick('commission_fee', 'platform_commission', 'commission_amount')
  // TODO confirm field name: payment / transaction processing fee.
  fees.payment_fee = pick('payment_fee', 'transaction_fee', 'payment_processing_fee')
  // TODO confirm field name: SFP / value-added service fee.
  fees.service_fee = pick('service_fee', 'sfp_service_fee', 'fbt_fulfillment_fee')
  // TODO confirm field name: seller-funded voucher / discount borne by seller.
  fees.seller_voucher = pick('seller_voucher', 'seller_discount', 'voucher_seller')
  // TODO confirm field name: shipping cost borne by the seller (net of buyer/platform subsidy).
  fees.shipping_borne = pick('shipping_fee_seller', 'actual_shipping_fee', 'shipping_cost')
  // TODO confirm field name: affiliate / creator commission (KOC).
  fees.affiliate_comm = pick('affiliate_commission', 'affiliate_partner_commission', 'creator_commission')

  return fees
}

/** Extract the date (YYYY-MM-DD) a statement should be bucketed under. */
function statementDate(st: FinanceStatement): string {
  // TODO confirm field name: which timestamp keys the statement to a day.
  const raw =
    st.statement_date ??
    (st as Record<string, unknown>).statement_time ??
    (st as Record<string, unknown>).payment_time ??
    (st as Record<string, unknown>).settlement_date
  const s = String(raw ?? '')
  // Accept "YYYY-MM-DD" directly, or an ISO/timestamp we can slice.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const n = Number(s)
  if (Number.isFinite(n) && n > 0) {
    // Unix seconds (or ms) -> YYYY-MM-DD.
    const ms = n < 1e12 ? n * 1000 : n
    return new Date(ms).toISOString().slice(0, 10)
  }
  return s.slice(0, 10)
}

/** Sum finance statements into per-day Fees, keyed by YYYY-MM-DD. */
export function feesByDay(finance: FinanceEnvelope): Map<string, Fees> {
  const map = new Map<string, Fees>()
  const statements = finance?.data?.statements ?? []
  for (const st of statements) {
    const day = statementDate(st)
    if (!day) continue
    const dayFees = normalizeFees(st)
    const acc = map.get(day) ?? blankFees()
    FEE_KEYS.forEach((k) => (acc[k] += dayFees[k]))
    map.set(day, acc)
  }
  return map
}

/** Convert a concrete YYYY-MM-DD to a days-ago offset relative to `today`. */
export function offsetOf(date: string, today: Date): number {
  const d = new Date(date + 'T00:00:00Z')
  const t = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )
  return Math.round((t.getTime() - d.getTime()) / 86_400_000)
}

/**
 * Combine one analytics interval + that day's fees into a DailyRow.
 * gmvNet0 = gmv − cancelled − returned. netRevenue nets the platform/payment/
 * service/voucher/shipping fees out of gmvNet0 (matches metrics.ts P&L identity;
 * affiliate_comm and kocBooking are subtracted at the profit stage, not here).
 */
function toDailyRow(interval: AnalyticsInterval, fees: Fees, today: Date, ads: number): DailyRow {
  const gmv = num(interval.gmv?.amount)
  const orders = num(interval.sku_orders)

  // TODO cancelled/returned amounts are not guaranteed on this analytics endpoint.
  // If present we use them; otherwise 0 (order-list / finance reconciliation is the
  // authoritative source for cancel/return — confirm against sandbox).
  const cancelled = num(interval.cancelled_amount?.amount)
  const returned = num(interval.returned_amount?.amount)
  const gmvNet0 = Math.max(0, gmv - cancelled - returned)

  const netRevenue =
    gmvNet0 -
    fees.commission_fee -
    fees.payment_fee -
    fees.service_fee -
    fees.seller_voucher -
    fees.shipping_borne

  // `ads` is now real: per-day spend from the TikTok API for Business report,
  // injected by date (days with no spend -> 0). profit is recomputed here so the
  // P&L identity still holds after ads stops being 0.
  // TODO still not sourced from TikTok:
  //   cogs     -> internal cost data (not a TikTok endpoint).
  //   kocBooking -> internal KOC booking store (manual entry).
  const cogs = 0
  const kocBooking = 0
  const profit = netRevenue - cogs - ads - fees.affiliate_comm - kocBooking

  // TODO source split (live/video/card/search) requires the traffic-source /
  // shop_lives analytics endpoints; not derivable from these two. Default 0.
  const sources = { live: 0, video: 0, card: 0, search: 0 }

  return {
    date: interval.start_date,
    off: offsetOf(interval.start_date, today),
    gmv,
    orders,
    gmvNet0,
    netRevenue,
    ads,
    cogs,
    kocBooking,
    profit,
    // TODO impressions/clicks are ad-platform metrics; analytics `impressions`
    // (product page views) is used if present, else 0. clicks default 0.
    impressions: num(interval.impressions),
    clicks: 0,
    cancelled,
    returned,
    fees,
    sources,
  }
}

/**
 * Build DailyRow[] from the two raw envelopes. One row per analytics interval,
 * merged with that day's normalized finance fees. Sorted by date ascending.
 */
export function normalizeDailySeries(
  analytics: AnalyticsEnvelope,
  finance: FinanceEnvelope,
  today: Date = new Date(),
  adsByDay: Map<string, number> = new Map(),
): DailyRow[] {
  const intervals = analytics?.data?.performance?.intervals ?? []
  const fees = feesByDay(finance)
  return intervals
    .map((iv) =>
      toDailyRow(iv, fees.get(iv.start_date) ?? blankFees(), today, adsByDay.get(iv.start_date) ?? 0),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Follower count -> tier label (best-effort; TODO confirm thresholds). */
function tierOf(followers: number): string {
  if (followers >= 500_000) return 'Macro'
  if (followers >= 50_000) return 'Mid'
  return 'Micro'
}

function fmtFollows(followers: number): string {
  if (followers >= 1_000_000) return (followers / 1_000_000).toFixed(1) + 'M'
  if (followers >= 1_000) return Math.round(followers / 1_000) + 'K'
  return String(followers)
}

/**
 * Aggregate affiliate orders by creator -> Creator[] (platform:'tiktok').
 *   gmv = Σ order gmv; commission = Σ order commission; videos = distinct content_id.
 *   booking = 0 (internal KOC booking store, not the affiliate API).
 *   cost = commission + booking; roi = gmv / cost; share = gmv / total gmv.
 */
export function normalizeCreators(orders: AffiliateOrder[], brand: string): Creator[] {
  interface Agg {
    id: string
    name?: string
    followers: number
    gmv: number
    commission: number
    videos: Set<string>
  }
  const byCreator = new Map<string, Agg>()
  for (const o of orders) {
    const id = String(o.creator_id ?? '')
    if (!id) continue
    const a =
      byCreator.get(id) ??
      { id, name: o.creator_name, followers: 0, gmv: 0, commission: 0, videos: new Set<string>() }
    a.gmv += num(o.gmv) // TODO confirm gmv field name
    a.commission += num(o.commission) // TODO confirm commission field name
    if (o.creator_follower_count != null) a.followers = num(o.creator_follower_count) // TODO confirm
    if (!a.name && o.creator_name) a.name = o.creator_name
    if (o.content_id) a.videos.add(String(o.content_id)) // TODO confirm content/video id
    byCreator.set(id, a)
  }
  const total = [...byCreator.values()].reduce((s, a) => s + a.gmv, 0) || 1
  return [...byCreator.values()]
    .map((a) => {
      const booking = 0 // TODO internal KOC booking store — not from the affiliate API.
      const cost = a.commission + booking
      return {
        id: a.id,
        name: a.name ?? `Creator ${a.id}`, // TODO derive/label if name absent
        brand, // TODO no brand dim in affiliate orders; caller-scoped brand stamped here
        platform: 'tiktok' as const,
        follows: fmtFollows(a.followers), // TODO default if follower count unavailable
        tier: tierOf(a.followers),
        gmv: a.gmv,
        commission: a.commission,
        booking,
        videos: a.videos.size || 1,
        cost,
        roi: cost ? a.gmv / cost : 0,
        share: a.gmv / total,
      }
    })
    .sort((x, y) => y.gmv - x.gmv)
}

/**
 * Shop product performance -> ProductPerf[]. gmv/qty from the report; marginPct
 * uses the store unit cost and the period net ratio:
 *   marginPct = (gmv × netRatio − qty × unitCost) / gmv.
 * share = gmv / Σ gmv. TODO confirm product-perf field names + granularity.
 */
export function normalizeTopProducts(
  products: ShopProduct[],
  catalog: Catalog,
  netRatio: number,
): ProductPerf[] {
  const rows = products.map((p) => {
    const sku = String(p.seller_sku ?? p.sku_id ?? '') // TODO confirm sku field
    const gmv = num(p.gmv?.amount)
    const qty = num(p.units_sold) || num(p.sku_orders)
    const cat = catalog.get(sku)
    return { sku, name: p.product_name ?? cat?.name ?? sku, gmv, qty, cat }
  })
  const total = rows.reduce((s, r) => s + r.gmv, 0) || 1
  return rows
    .map((r) => {
      const unitCost = r.cat?.unitCost ?? 0
      const marginPct = r.gmv ? (r.gmv * netRatio - r.qty * unitCost) / r.gmv : 0
      return {
        sku: r.sku,
        brand: r.cat?.brand ?? 'nonelab', // TODO no brand dim on product perf; from catalog
        name: r.name,
        cost: unitCost,
        price: r.cat?.price ?? 0,
        gmv: r.gmv,
        qty: r.qty,
        marginPct,
        share: r.gmv / total,
      }
    })
    .sort((a, b) => b.gmv - a.gmv)
}

/** Order status values that count as settled. TODO confirm enum. */
function ttSettled(status: string): boolean {
  return /SETTLED|COMPLETED|DELIVERED/i.test(status)
}

/**
 * Order search + finance fees -> ReconOrder[]. One recon row per order. Finance
 * statements are DAILY (whole-shop), so we convert each day's fee pool into a fee
 * RATE (poolFee / dayGmv from the analytics intervals) and apply it to the order's
 * gmv. This keeps per-order fees realistic even when the order sample is a subset
 * of the day. net = gmv − Σ fees. TODO confirm order-search + settlement field names.
 */
export function normalizeReconOrders(
  search: OrderSearchEnvelope,
  finance: FinanceEnvelope,
  catalog: Catalog,
  analytics?: AnalyticsEnvelope,
): ReconOrder[] {
  const orders = search?.data?.orders ?? []
  const feesPerDay = feesByDay(finance)
  // Day gmv from analytics (whole-shop) so the fee rate has the right denominator.
  const gmvPerDay = new Map<string, number>()
  for (const iv of analytics?.data?.performance?.intervals ?? []) {
    gmvPerDay.set(iv.start_date, num(iv.gmv?.amount))
  }
  const orderDay = (o: SearchedOrder) =>
    o.create_time ? new Date(o.create_time * 1000).toISOString().slice(0, 10) : ''
  const orderGmv = (o: SearchedOrder) =>
    num(o.payment?.total_amount) || num(o.total_amount) ||
    (o.line_items ?? []).reduce((s, li) => s + num(li.sale_price) * (num(li.quantity) || 1), 0)

  return orders
    .map((o) => {
      const day = orderDay(o)
      const gmv = orderGmv(o)
      const li = (o.line_items ?? [])[0]
      const sku = String(li?.seller_sku ?? li?.sku_id ?? '')
      const cat = catalog.get(sku)
      const qty = (o.line_items ?? []).reduce((s, x) => s + (num(x.quantity) || 1), 0) || 1
      // Fee rate for the day (pool / day gmv), applied to this order's gmv.
      const dayGmv = gmvPerDay.get(day) || 0
      const pool = feesPerDay.get(day) ?? blankFees()
      const fees = {} as Fees
      FEE_KEYS.forEach((k) => (fees[k] = dayGmv ? (pool[k] / dayGmv) * gmv : 0))
      const net = gmv - FEE_KEYS.reduce((s, k) => s + fees[k], 0)
      return {
        id: o.id,
        platform: 'tiktok' as const,
        brand: cat?.brand ?? 'nonelab',
        date: day,
        sku,
        product: li?.product_name ?? cat?.name ?? sku,
        qty,
        gmv,
        fees,
        net,
        isSettled: ttSettled(String(o.status ?? '')),
      }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
