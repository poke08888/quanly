// Shop resolution + result merging for the multi-brand / multi-shop model.
// A brand can own MANY shops per platform; the BFF fetches each shop independently
// (sample fixtures or live API, per shop.mode) and MERGES the results here — the
// same day-by-day / by-sku summing the frontend DataRepository does across platforms.

import { listShops, type ShopRow } from './store/db'
import type { ShopPlatform } from './store/seed'

/** Active shops of a platform for a brand ('group' = every brand's shops). */
export function resolveShops(platform: ShopPlatform, brand: string): ShopRow[] {
  return listShops({ platform, brandKey: brand, activeOnly: true })
}

// ---- generic mergeable shapes (structurally shared by tiktok/ + shopee/ types) ----

interface Fees {
  commission_fee: number
  payment_fee: number
  service_fee: number
  seller_voucher: number
  shipping_borne: number
  affiliate_comm: number
}
interface Sources {
  live: number
  video: number
  card: number
  search: number
}
interface DailyRowLike {
  date: string
  off: number
  gmv: number
  orders: number
  gmvNet0: number
  netRevenue: number
  ads: number
  cogs: number
  kocBooking: number
  profit: number
  impressions: number
  clicks: number
  cancelled: number
  returned: number
  fees: Fees
  sources: Sources
}

/** Sum per-shop daily series day-by-day (mirrors DataRepository.series merge). */
export function mergeDailyRows<T extends DailyRowLike>(parts: T[][]): T[] {
  const byDate = new Map<string, T>()
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
        ;(Object.keys(existing.fees) as (keyof Fees)[]).forEach(
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

/** Concatenate per-shop campaign lists, biggest spend first. */
export function mergeCampaigns<T extends { spend: number }>(parts: T[][]): T[] {
  return parts.flat().sort((a, b) => b.spend - a.spend)
}

/** Concatenate per-shop creator lists, biggest GMV first. */
export function mergeCreators<T extends { gmv: number }>(parts: T[][]): T[] {
  return parts.flat().sort((a, b) => b.gmv - a.gmv)
}

/** Sum per-shop top-products by sku, recompute share against the combined total. */
export function mergeTopProducts<T extends { sku: string; gmv: number; qty: number; share: number }>(
  parts: T[][],
): T[] {
  if (parts.length === 1) return parts[0] ?? []
  const bySku = new Map<string, T>()
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

/** Concatenate per-shop recon orders, most recent first, capped for a usable table. */
export function mergeRecon<T extends { date: string }>(parts: T[][], cap = 120): T[] {
  return parts
    .flat()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, cap)
}
