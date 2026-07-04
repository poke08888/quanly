// View builders: aggregate metrics + lists PURELY from SQLite. Mirrors the old
// DataRepository.foldInternalCosts + server merge logic so numbers match the old app.
// No external API calls — reads come from api/readdb.ts, config from api/store.ts.
import {
  loadDailyRows,
  loadHourly,
  loadRawOrders,
  loadReconCache,
  loadSnapshotExact,
  loadSnapshotLatest,
  resolveShops,
} from './readdb'
import { cogsMap, listCogs, listBookings, mergeCampaigns, mergeCreators, mergeDailyRows, mergeRecon, mergeTopProducts } from './store'
import {
  netRatioOf,
  topProductsFromShopeeOrders,
  topProductsFromTiktokOrders,
  type Catalog,
} from './normalize'
import { aggregateFromRows, withKpis } from '../src/domain/metrics'
import { FEE_KEYS } from '../src/data/types'
import type { Aggregate, Campaign, Creator, DailyRow, PlatformFilter, Platform, ProductPerf, ReconOrder } from '../src/data/types'

type P = Platform

function platformsFor(filter: PlatformFilter): P[] {
  return filter === 'all' ? ['tiktok', 'shopee'] : [filter]
}

// NOTE: brand scoping happens at the SHOP level (resolveShops returns only the brand's
// shops; each shop belongs to exactly one brand). We deliberately do NOT filter by the
// per-row `.brand` field — that field is catalog-derived and defaults to 'nonelab' when a
// SKU isn't in the cost table, which would wrongly drop real orders for other brands.

/** sku -> {unitCost, brand, name, price} from the cost store (single source for P&L). */
function buildCatalog(): Catalog {
  const cat: Catalog = new Map()
  for (const c of listCogs()) cat.set(c.sku, { unitCost: c.unitCost, brand: c.brand, name: c.name, price: c.price })
  return cat
}

/** Merged daily rows for one platform across a brand's shops. */
function dailyForPlatform(p: P, brand: string, start: string, end: string): DailyRow[] {
  const per = resolveShops(p, brand).map((s) => loadDailyRows(s.id, p, start, end))
  return mergeDailyRows(per)
}

// ---- tiny in-memory memo (with expiry sweep so the map can't grow unbounded) ----

const memoStore = new Map<string, { val: unknown; exp: number }>()

function memo<T>(key: string, ttlMs: number, fn: () => T): T {
  const now = Date.now()
  const hit = memoStore.get(key)
  if (hit && hit.exp > now) return hit.val as T
  const val = fn()
  memoStore.set(key, { val, exp: now + ttlMs })
  if (memoStore.size > 300) {
    for (const [k, v] of memoStore) if (v.exp <= now) memoStore.delete(k)
  }
  return val
}

const MEMO_TTL = 60_000 // poller cadence — fresher than this doesn't exist in the DB anyway

// ---- top products ----

/** Per-shop top products, memoized: /api/view/overview computes aggregates for
 *  tiktok + shopee + prev window and each folds COGS via topProducts — without the
 *  memo that meant parsing the multi-MB raw_orders JSON ~6× per request. */
function topProductsForShop(shopId: number, p: P, start: string, end: string, cat: Catalog): ProductPerf[] {
  return memo(`top:${shopId}:${p}:${start}:${end}`, MEMO_TTL, () => {
    const period = `${start}:${end}`
    const cached = loadSnapshotExact<ProductPerf>(shopId, p, 'top_products', period)
    if (cached) return cached
    const orders = loadRawOrders<Record<string, unknown>>(shopId, p, start, end)
    if (orders.length === 0) return []
    const netRatio = netRatioOf(loadDailyRows(shopId, p, start, end))
    return p === 'tiktok'
      ? topProductsFromTiktokOrders(orders as never, cat, netRatio)
      : topProductsFromShopeeOrders(orders as never, cat, netRatio)
  })
}

export function topProducts(filter: PlatformFilter, brand: string, start: string, end: string): ProductPerf[] {
  const cat = buildCatalog()
  const per: ProductPerf[][] = []
  for (const p of platformsFor(filter)) {
    for (const shop of resolveShops(p, brand)) per.push(topProductsForShop(shop.id, p, start, end, cat))
  }
  return mergeTopProducts(per)
}

// ---- P&L aggregate (with internal cost fold) ----

function bookingFee(filter: PlatformFilter, brand: string, start: string, end: string): number {
  const rows = listBookings({
    platform: filter === 'all' ? undefined : filter,
    brand: brand === 'group' ? undefined : brand,
  })
  return rows.filter((b) => b.date >= start && b.date <= end).reduce((s, b) => s + b.fee, 0)
}

export function aggregate(filter: PlatformFilter, brand: string, start: string, end: string): Aggregate {
  const rows: DailyRow[] = []
  for (const p of platformsFor(filter)) rows.push(...dailyForPlatform(p, brand, start, end))
  const acc = aggregateFromRows(rows)
  // Fold internal costs so the P&L identity holds (daily_data stores cogs/koc as 0):
  const tops = topProducts(filter, brand, start, end)
  const cm = cogsMap()
  acc.cogs = tops.reduce((s, t) => s + t.qty * (cm.get(t.sku) ?? 0), 0)
  acc.kocBooking = bookingFee(filter, brand, start, end)
  acc.profit = acc.netRevenue - acc.cogs - acc.ads - acc.fees.affiliate_comm - acc.kocBooking
  return withKpis(acc)
}

// ---- campaigns / creators / recon ----

export function campaigns(filter: PlatformFilter, brand: string, start: string, end: string): Campaign[] {
  const period = `${start}:${end}`
  const per: Campaign[][] = []
  for (const p of platformsFor(filter)) {
    for (const shop of resolveShops(p, brand)) {
      const snap =
        loadSnapshotExact<Campaign>(shop.id, p, 'campaigns', period) ??
        loadSnapshotLatest<Campaign>(shop.id, p, 'campaigns') ??
        []
      per.push(snap)
    }
  }
  return mergeCampaigns(per)
}

export function creators(filter: PlatformFilter, brand: string, start: string, end: string): Creator[] {
  if (filter === 'shopee') return [] // creators are TikTok-affiliate only
  const period = `${start}:${end}`
  const per: Creator[][] = []
  for (const shop of resolveShops('tiktok', brand)) {
    const snap =
      loadSnapshotExact<Creator>(shop.id, 'tiktok', 'creators', period) ??
      loadSnapshotLatest<Creator>(shop.id, 'tiktok', 'creators') ??
      []
    per.push(snap)
  }
  return mergeCreators(per)
}

export function recon(filter: PlatformFilter, brand: string): ReconOrder[] {
  const per: ReconOrder[][] = []
  for (const p of platformsFor(filter)) {
    for (const shop of resolveShops(p, brand)) {
      per.push(loadReconCache<ReconOrder>(shop.id, p) ?? [])
    }
  }
  return mergeRecon(per)
}

/** Merged daily series across the filtered platforms, with `off` recomputed vs real today. */
export function series(filter: PlatformFilter, brand: string, start: string, end: string): DailyRow[] {
  const per = platformsFor(filter).map((p) => dailyForPlatform(p, brand, start, end))
  const rows = mergeDailyRows(per)
  const now = new Date()
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const r of rows) r.off = Math.round((t0 - new Date(r.date + 'T00:00:00').getTime()) / 86_400_000)
  return rows
}

/** GMV only over a window (cheap — no cost fold). Used for KPI actuals. */
export function gmvOnly(filter: PlatformFilter, brand: string, start: string, end: string): number {
  let gmv = 0
  for (const p of platformsFor(filter)) for (const r of dailyForPlatform(p, brand, start, end)) gmv += r.gmv
  return gmv
}

// ---- real hourly series (from poller's cumulative hourly snapshots) ----

export interface HourPoint {
  hour: number
  gmv: number
  cost: number
  profit: number
}

/** Total cost of a cumulative row: COGS + ads + KOC + 6 platform fees (mirror of chart's rowCost). */
function cumCost(r: DailyRow): number {
  const f = r.fees
  return (
    r.cogs + r.ads + r.kocBooking +
    f.commission_fee + f.payment_fee + f.service_fee +
    f.seller_voucher + f.shipping_borne + f.affiliate_comm
  )
}

/**
 * REAL per-hour points for `date`: per shop, forward-fill the cumulative snapshots
 * over 0..maxHour, sum across shops, then take hour-over-hour deltas (clamped ≥0 —
 * cancellations can make cumulative GMV dip). Empty array when no snapshots yet
 * (e.g. historical days before this feature) — the chart falls back to the estimate.
 */
export function hourlySeries(filter: PlatformFilter, brand: string, date: string): HourPoint[] {
  interface Cum { gmv: number; cost: number; profit: number }
  const perShop: Array<Map<number, Cum>> = []
  let maxHour = -1
  for (const p of platformsFor(filter)) {
    for (const shop of resolveShops(p, brand)) {
      const snaps = loadHourly<DailyRow>(shop.id, p, date)
      if (snaps.length === 0) continue
      const m = new Map<number, Cum>()
      for (const s of snaps) {
        m.set(s.hour, { gmv: s.data.gmv, cost: cumCost(s.data), profit: s.data.profit })
        if (s.hour > maxHour) maxHour = s.hour
      }
      perShop.push(m)
    }
  }
  if (maxHour < 0) return []

  const points: HourPoint[] = []
  let prev: Cum = { gmv: 0, cost: 0, profit: 0 }
  const carry: Cum[] = perShop.map(() => ({ gmv: 0, cost: 0, profit: 0 }))
  for (let h = 0; h <= maxHour; h++) {
    const total: Cum = { gmv: 0, cost: 0, profit: 0 }
    perShop.forEach((m, i) => {
      const cur = m.get(h)
      if (cur) carry[i] = cur // forward-fill gaps (poller down / hour skipped)
      total.gmv += carry[i].gmv
      total.cost += carry[i].cost
      total.profit += carry[i].profit
    })
    points.push({
      hour: h,
      gmv: Math.max(0, total.gmv - prev.gmv),
      cost: Math.max(0, total.cost - prev.cost),
      profit: Math.max(0, total.profit - prev.profit),
    })
    prev = total
  }
  return points
}

// ---- orders page (server-side filter + sort + paginate over recon) ----

const feeTotal = (r: ReconOrder): number => FEE_KEYS.reduce((a, k) => a + r.fees[k], 0)

/** Column accessor — SAME keys/semantics as OrdersM7's client-side orderVal. */
function orderVal(r: ReconOrder, k: string): number | string {
  switch (k) {
    case 'id':
      return r.id
    case 'platform':
      return r.platform
    case 'date':
      return r.date
    case 'product':
      return r.product
    case 'qty':
      return r.qty
    case 'gmv':
      return r.gmv
    case 'fee':
      return feeTotal(r)
    case 'net':
      return r.net
    default:
      return 0
  }
}

/** Sort a COPY — matches useSort (asc by number/vi-locale string, reversed when desc). */
function sortOrders(rows: ReconOrder[], key: string, dir: 'asc' | 'desc'): ReconOrder[] {
  if (!key) return rows
  const arr = [...rows].sort((a, b) => {
    const va = orderVal(a, key)
    const vb = orderVal(b, key)
    if (typeof va === 'number' && typeof vb === 'number') return va - vb
    return String(va).localeCompare(String(vb), 'vi')
  })
  if (dir === 'desc') arr.reverse()
  return arr
}

/** Parsed+merged recon list per (brand|platform), so paging/search/sort don't re-parse
 *  the ~10MB recon_cache blobs on every request (shared memo, expiry-swept). */
function reconList(filter: PlatformFilter, brand: string): ReconOrder[] {
  return memo(`recon:${brand}|${filter}`, MEMO_TTL, () => recon(filter, brand))
}

export interface OrdersPageOpts {
  status: 'all' | 'settled' | 'pending'
  q: string
  sortKey: string
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface OrdersPageResult {
  rows: ReconOrder[]
  total: number
  totals: { gmv: number; fee: number; net: number }
}

/** One page of orders + totals over the FILTERED set (StatCards reflect the filter). */
export function ordersPage(filter: PlatformFilter, brand: string, opts: OrdersPageOpts): OrdersPageResult {
  const query = opts.q.trim().toLowerCase()
  const filtered = reconList(filter, brand).filter((r) => {
    if (opts.status !== 'all' && (opts.status === 'settled') !== r.isSettled) return false
    if (query && !(`#${r.id}`.toLowerCase().includes(query) || r.product.toLowerCase().includes(query))) return false
    return true
  })

  const totals = { gmv: 0, fee: 0, net: 0 }
  for (const r of filtered) {
    totals.gmv += r.gmv
    totals.fee += feeTotal(r)
    totals.net += r.net
  }

  const sorted = sortOrders(filtered, opts.sortKey, opts.sortDir)
  const start = Math.max(0, opts.page) * opts.pageSize
  return { rows: sorted.slice(start, start + opts.pageSize), total: filtered.length, totals }
}
