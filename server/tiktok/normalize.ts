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
  const s = st as Record<string, unknown>
  // TikTok Finance Statements API returns a single `fee_amount` (negative = deducted from seller).
  // No per-type breakdown is available at statement level; we record the total as commission_fee.
  fees.commission_fee = Math.abs(num(s.fee_amount ?? 0))
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
  const sources = { live: 0, video: 0, card: 0, search: 0, affiliate: 0 }

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

/**
 * Build DailyRow[] from raw orders when analytics is unavailable (e.g. 504 timeout).
 * GMV is summed from order payment amounts grouped by creation day (UTC+7).
 * impressions/clicks/cancelled/returned default to 0 (not available from order search).
 */
export function normalizeDailyFromOrders(
  orders: SearchedOrder[],
  finance: FinanceEnvelope,
  today: Date = new Date(),
  adsByDay: Map<string, number> = new Map(),
): DailyRow[] {
  const byDay = new Map<string, { gmv: number; count: number }>()
  for (const o of orders) {
    const sec = o.create_time ?? 0
    if (!sec) continue
    // Convert Unix seconds to YYYY-MM-DD in UTC+7 (Vietnam)
    const d = new Date((sec + 7 * 3600) * 1000).toISOString().slice(0, 10)
    const amt = num(o.payment?.total_amount ?? o.total_amount ?? 0)
    const prev = byDay.get(d) ?? { gmv: 0, count: 0 }
    byDay.set(d, { gmv: prev.gmv + amt, count: prev.count + 1 })
  }
  // Period-level fee rate: TikTok settles on a cycle (T+7 or bi-weekly), so
  // statement_time doesn't align with order create_time. Sum ALL statement fees
  // and distribute proportionally to each day's share of total GMV.
  const periodFees = blankFees()
  for (const st of finance?.data?.statements ?? []) {
    const f = normalizeFees(st)
    FEE_KEYS.forEach((k) => (periodFees[k] += f[k]))
  }
  const totalGmv = [...byDay.values()].reduce((s, { gmv }) => s + gmv, 0) || 1
  return [...byDay.entries()]
    .map(([date, { gmv, count }]) => {
      const dayFees = blankFees()
      FEE_KEYS.forEach((k) => (dayFees[k] = (periodFees[k] / totalGmv) * gmv))
      const ads = adsByDay.get(date) ?? 0
      const gmvNet0 = gmv
      const netRevenue =
        gmvNet0 -
        dayFees.commission_fee -
        dayFees.payment_fee -
        dayFees.service_fee -
        dayFees.seller_voucher -
        dayFees.shipping_borne
      return {
        date,
        off: offsetOf(date, today),
        gmv,
        orders: count,
        gmvNet0,
        netRevenue,
        ads,
        cogs: 0,
        kocBooking: 0,
        profit: netRevenue - ads - dayFees.affiliate_comm,
        impressions: 0,
        clicks: 0,
        cancelled: 0,
        returned: 0,
        fees: dayFees,
        sources: { live: 0, video: 0, card: 0, search: 0, affiliate: 0 },
      } as DailyRow
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))
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
/** First non-empty value among dotted-path candidates. The affiliate API's field
 *  names can't be confirmed until the Affiliate Seller scope is granted, so the
 *  aggregation extracts defensively; the client logs order[0]'s keys on the first
 *  successful page so the candidates can be tightened from the prod log. */
function pick(o: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    const v = p
      .split('.')
      .reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o)
    if (v != null && v !== '') return v
  }
  return undefined
}

function itemsOf(o: AffiliateOrder): Array<Record<string, unknown>> {
  const items = pick(o, 'items', 'order_line_items', 'skus', 'products')
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : []
}

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
    const id = String(
      pick(o, 'creator_user_id', 'creator_id', 'creator.user_id', 'creator.creator_id') ?? '',
    )
    if (!id) continue
    const name = pick(
      o,
      'creator_username', 'creator_name', 'creator_nickname',
      'creator.username', 'creator.nickname', 'creator.name',
    ) as string | undefined
    const a =
      byCreator.get(id) ??
      { id, name, followers: 0, gmv: 0, commission: 0, videos: new Set<string>() }
    const items = itemsOf(o)
    const gmv =
      pick(o, 'payment_amount', 'pay_amount', 'order_amount', 'settlement_amount', 'gmv') ??
      items.reduce((s, it) => s + num(pick(it, 'payment_amount', 'pay_amount', 'sale_price', 'item_amount')), 0)
    const commission =
      pick(o, 'actual_commission', 'estimated_commission', 'affiliate_commission', 'commission') ??
      items.reduce(
        (s, it) => s + num(pick(it, 'actual_commission', 'estimated_commission', 'commission')),
        0,
      )
    a.gmv += num(gmv)
    a.commission += num(commission)
    const followers = pick(o, 'creator_follower_count', 'creator.follower_count')
    if (followers != null) a.followers = num(followers)
    if (!a.name && name) a.name = name
    const content =
      pick(o, 'content_id', 'video_id') ?? items.map((it) => pick(it, 'content_id', 'video_id')).find(Boolean)
    if (content) a.videos.add(String(content))
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

/**
 * Compute top products directly from order search results — groups line_items
 * by seller_sku, sums GMV and quantity. Preferred over the product-performance
 * API because order data is already stored in raw_orders (no extra API call).
 */
export function normalizeTopProductsFromOrders(
  orders: SearchedOrder[],
  catalog: Catalog,
  netRatio: number,
): ProductPerf[] {
  interface Agg { sku: string; name?: string; gmv: number; qty: number }
  const bySku = new Map<string, Agg>()
  for (const o of orders) {
    for (const li of o.line_items ?? []) {
      const sku = String(li.seller_sku ?? li.sku_id ?? '')
      if (!sku) continue
      const qty = num(li.quantity) || 1
      const unitPrice = num(li.sale_price) || num(li.original_price) || 0
      const gmv = unitPrice * qty
      const a = bySku.get(sku) ?? { sku, name: li.product_name, gmv: 0, qty: 0 }
      a.gmv += gmv
      a.qty += qty
      if (!a.name && li.product_name) a.name = li.product_name
      bySku.set(sku, a)
    }
  }
  const total = [...bySku.values()].reduce((s, a) => s + a.gmv, 0) || 1
  return [...bySku.values()]
    .map((a) => {
      const cat = catalog.get(a.sku)
      const unitCost = cat?.unitCost ?? 0
      const marginPct = a.gmv ? (a.gmv * netRatio - a.qty * unitCost) / a.gmv : 0
      return {
        sku: a.sku,
        brand: cat?.brand ?? 'nonelab',
        name: a.name ?? cat?.name ?? a.sku,
        cost: unitCost,
        price: cat?.price ?? 0,
        gmv: a.gmv,
        qty: a.qty,
        marginPct,
        share: a.gmv / total,
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
  _analytics?: AnalyticsEnvelope,
): ReconOrder[] {
  const orders = search?.data?.orders ?? []
  // Period-level fee rate: settlement dates ≠ order creation dates, so per-day
  // matching produces wrong rates. Sum ALL statement fees and apply uniformly.
  const periodFees = blankFees()
  for (const st of finance?.data?.statements ?? []) {
    const f = normalizeFees(st)
    FEE_KEYS.forEach((k) => (periodFees[k] += f[k]))
  }
  const orderGmv = (o: SearchedOrder) =>
    num(o.payment?.total_amount) || num(o.total_amount) ||
    (o.line_items ?? []).reduce((s, li) => s + num(li.sale_price) * (num(li.quantity) || 1), 0)
  const periodGmv = orders.reduce((s, o) => s + orderGmv(o), 0) || 1

  return orders
    .map((o) => {
      const day = o.create_time
        ? new Date((o.create_time + 7 * 3600) * 1000).toISOString().slice(0, 10)
        : ''
      const gmv = orderGmv(o)
      const li = (o.line_items ?? [])[0]
      const sku = String(li?.seller_sku ?? li?.sku_id ?? '')
      const cat = catalog.get(sku)
      const qty = (o.line_items ?? []).reduce((s, x) => s + (num(x.quantity) || 1), 0) || 1
      // Đơn nhiều sản phẩm: gộp đủ line_items theo tên (TikTok lặp 1 dòng/sản phẩm;
      // trước đây chỉ lấy dòng đầu nên đơn mua nhiều món hiển thị thiếu).
      const itemAgg = new Map<string, number>()
      for (const x of o.line_items ?? []) {
        const name = String(x.product_name ?? x.seller_sku ?? x.sku_id ?? '')
        if (name) itemAgg.set(name, (itemAgg.get(name) ?? 0) + (num(x.quantity) || 1))
      }
      const items = [...itemAgg.entries()].map(([name, n]) => ({ name, qty: n }))
      const fees = blankFees()
      FEE_KEYS.forEach((k) => (fees[k] = (periodFees[k] / periodGmv) * gmv))
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
        ...(items.length > 1 ? { items } : {}),
      }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
