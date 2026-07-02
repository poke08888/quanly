// High-level API the UI calls. Fans out to per-platform connectors via the registry
// and MERGES by the active platform filter. When filter is 'all' it calls BOTH
// tiktok + shopee connectors and combines (sum aggregates, concat lists); otherwise
// just the one. All methods async so the mock->real swap is transparent.

import type {
  Aggregate,
  Booking,
  Campaign,
  Creator,
  DailyRow,
  Period,
  Platform,
  PlatformFilter,
  Product,
  ProductPerf,
  ReconOrder,
} from './types'
import { getConnector } from './connectors/registry'
import { aggregateFromRows, withKpis } from '../domain/metrics'
import { fetchBookings, fetchCatalog, fetchCogsMap, dateFromOffset } from './costStore'

function platformsFor(filter: PlatformFilter): Platform[] {
  if (filter === 'all') return ['tiktok', 'shopee']
  return [filter]
}

export class DataRepository {
  /** Per-day merged series across the active platforms. */
  async series(
    filter: PlatformFilter,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<DailyRow[]> {
    const parts = await Promise.all(
      platformsFor(filter).map((p) =>
        getConnector(p).getDailySeries(startOffset, endOffset, brand),
      ),
    )
    // Merge day-by-day (rows share the same date/off ordering per platform).
    const byDate = new Map<string, DailyRow>()
    const order: string[] = []
    for (const rows of parts) {
      for (const r of rows) {
        const existing = byDate.get(r.date)
        if (!existing) {
          byDate.set(r.date, structuredClone(r))
          order.push(r.date)
        } else {
          existing.gmv += r.gmv
          existing.orders += r.orders
          existing.gmvNet0 += r.gmvNet0
          existing.netRevenue += r.netRevenue
          existing.ads += r.ads
          existing.cogs += r.cogs
          existing.kocBooking += r.kocBooking
          existing.profit += r.profit
          existing.impressions += r.impressions
          existing.clicks += r.clicks
          existing.cancelled += r.cancelled
          existing.returned += r.returned
          ;(Object.keys(existing.fees) as (keyof DailyRow['fees'])[]).forEach(
            (k) => (existing.fees[k] += r.fees[k]),
          )
          ;(['live', 'video', 'card', 'search'] as const).forEach(
            (s) => (existing.sources[s] += r.sources[s]),
          )
        }
      }
    }
    return order.map((d) => byDate.get(d)!)
  }

  /**
   * OVERRIDE cogs + kocBooking from the internal cost store (single source of truth
   * for BOTH mock and api paths — avoids double-counting whatever a connector put
   * there), then recompute profit + KPIs so the aggregate P&L identity holds:
   *   gmv = profit + cogs + ads + affiliate_comm + (commission+payment+service)
   *         + (seller_voucher+shipping_borne) + (cancelled+returned) + kocBooking
   *   cogs      = Σ topProducts(qty × storeUnitCost[sku])  (0 if sku not in store)
   *   kocBooking = Σ bookings in [start,end] window, filtered by platform (+ brand)
   */
  private async foldInternalCosts(
    acc: Aggregate,
    filter: PlatformFilter,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<Aggregate> {
    const [topProducts, cogsUnit, bookings] = await Promise.all([
      this.topProducts(filter, startOffset, endOffset, brand),
      fetchCogsMap(),
      fetchBookings(filter === 'all' ? 'all' : filter, brand),
    ])
    // cogs from qty × store unit cost.
    acc.cogs = topProducts.reduce((s, p) => s + p.qty * (cogsUnit.get(p.sku) ?? 0), 0)
    // kocBooking from bookings whose date falls in the period window.
    const endDate = dateFromOffset(endOffset)
    const startDate = dateFromOffset(startOffset)
    acc.kocBooking = bookings
      .filter((b) => b.date >= startDate && b.date <= endDate)
      .reduce((s, b) => s + b.fee, 0)
    // Recompute profit + KPIs (netRevenue already nets fees except affiliate/booking).
    acc.profit = acc.netRevenue - acc.cogs - acc.ads - acc.fees.affiliate_comm - acc.kocBooking
    return withKpis(acc)
  }

  /** Merged aggregate over a window for the active platforms (cost fold applied). */
  async aggregate(
    filter: PlatformFilter,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<Aggregate> {
    const rows = await this.series(filter, startOffset, endOffset, brand)
    const acc = aggregateFromRows(rows)
    return this.foldInternalCosts(acc, filter, startOffset, endOffset, brand)
  }

  /** Convenience: aggregate for a Period's current window. */
  async aggregatePeriod(
    filter: PlatformFilter,
    period: Period,
    brand: string,
    which: 'cur' | 'prev' = 'cur',
  ): Promise<Aggregate> {
    const [s, e] = period[which]
    return this.aggregate(filter, s, e, brand)
  }

  /** Single-platform aggregate (used by the M1 platform pie), cost fold applied. */
  async aggregatePlatform(
    platform: Platform,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<Aggregate> {
    const rows = await getConnector(platform).getDailySeries(startOffset, endOffset, brand)
    const acc = aggregateFromRows(rows)
    return this.foldInternalCosts(acc, platform, startOffset, endOffset, brand)
  }

  async campaigns(
    filter: PlatformFilter,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<Campaign[]> {
    const parts = await Promise.all(
      platformsFor(filter).map((p) => getConnector(p).getCampaigns(startOffset, endOffset, brand)),
    )
    return parts.flat().sort((a, b) => b.spend - a.spend)
  }

  async creators(
    filter: PlatformFilter,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<Creator[]> {
    const parts = await Promise.all(
      platformsFor(filter).map((p) => getConnector(p).getCreators(startOffset, endOffset, brand)),
    )
    return parts.flat().sort((a, b) => b.gmv - a.gmv)
  }

  async topProducts(
    filter: PlatformFilter,
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<ProductPerf[]> {
    const platforms = platformsFor(filter)
    const parts = await Promise.all(
      platforms.map((p) => getConnector(p).getTopProducts(startOffset, endOffset, brand)),
    )
    if (platforms.length === 1) return parts[0]
    // 'all': sum GMV/qty per SKU, recompute share against the combined total.
    const bySku = new Map<string, ProductPerf>()
    for (const list of parts) {
      for (const p of list) {
        const cur = bySku.get(p.sku)
        if (!cur) bySku.set(p.sku, { ...p })
        else {
          cur.gmv += p.gmv
          cur.qty += p.qty
        }
      }
    }
    const merged = [...bySku.values()]
    const total = merged.reduce((s, p) => s + p.gmv, 0) || 1
    merged.forEach((p) => (p.share = p.gmv / total))
    return merged.sort((a, b) => b.gmv - a.gmv)
  }

  async reconOrders(filter: PlatformFilter, brand: string): Promise<ReconOrder[]> {
    const parts = await Promise.all(
      platformsFor(filter).map((p) => getConnector(p).getReconOrders(brand)),
    )
    return parts.flat().sort((a, b) => (a.date < b.date ? 1 : -1))
  }

  async productCatalog(): Promise<Product[]> {
    // Catalog is platform-agnostic and comes from the persisted cost store (the
    // single source of truth for SKU cost/price), not a connector.
    return fetchCatalog()
  }

  async bookings(filter: PlatformFilter, brand: string): Promise<Booking[]> {
    // Bookings are internal data — read from the persisted cost store, filtered by
    // the active platform + brand. (Not a PlatformConnector concern.)
    return fetchBookings(filter === 'all' ? 'all' : filter, brand)
  }
}

export const repository = new DataRepository()
export { withKpis }
