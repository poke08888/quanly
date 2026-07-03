// Pure helpers to derive top-products from raw orders stored in SQLite (raw_orders).
// Formulas match the poller's normalizers exactly so numbers agree with the old app.
import type { ProductPerf } from '../src/data/types'

export type Catalog = Map<string, { unitCost: number; brand: string; name: string; price: number }>

export function num(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  let cur = start
  while (cur <= end) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/** netRevenue / gmv over a set of daily rows (0 when gmv is 0). */
export function netRatioOf(rows: Array<{ gmv: number; netRevenue: number }>): number {
  let gmv = 0
  let net = 0
  for (const r of rows) {
    gmv += r.gmv
    net += r.netRevenue
  }
  return gmv ? net / gmv : 0
}

interface Agg {
  sku: string
  name?: string
  gmv: number
  qty: number
}

function finish(bySku: Map<string, Agg>, catalog: Catalog, netRatio: number): ProductPerf[] {
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

interface TkLineItem {
  seller_sku?: string
  sku_id?: string
  product_name?: string
  quantity?: number | string
  sale_price?: number | string
  original_price?: number | string
}
interface TkOrder {
  line_items?: TkLineItem[]
}

/** TikTok: group order line_items by seller_sku (matches normalizeTopProductsFromOrders). */
export function topProductsFromTiktokOrders(orders: TkOrder[], catalog: Catalog, netRatio: number): ProductPerf[] {
  const bySku = new Map<string, Agg>()
  for (const o of orders) {
    for (const li of o.line_items ?? []) {
      const sku = String(li.seller_sku ?? li.sku_id ?? '')
      if (!sku) continue
      const qty = num(li.quantity) || 1
      const unitPrice = num(li.sale_price) || num(li.original_price) || 0
      const a = bySku.get(sku) ?? { sku, name: li.product_name, gmv: 0, qty: 0 }
      a.gmv += unitPrice * qty
      a.qty += qty
      if (!a.name && li.product_name) a.name = li.product_name
      bySku.set(sku, a)
    }
  }
  return finish(bySku, catalog, netRatio)
}

interface SpItem {
  item_sku?: string
  model_sku?: string
  item_name?: string
  model_quantity_purchased?: number | string
  model_discounted_price?: number | string
  model_original_price?: number | string
}
interface SpOrder {
  order_status?: string
  item_list?: SpItem[]
}

const spCancelled = (s?: string) => /CANCEL/i.test(s ?? '')
const spReturned = (s?: string) => /RETURN|REFUND/i.test(s ?? '')

/** Shopee: group item_list by item_sku, skipping cancelled/returned (matches normalizeTopProducts). */
export function topProductsFromShopeeOrders(orders: SpOrder[], catalog: Catalog, netRatio: number): ProductPerf[] {
  const bySku = new Map<string, Agg>()
  for (const o of orders) {
    if (spCancelled(o.order_status) || spReturned(o.order_status)) continue
    for (const li of o.item_list ?? []) {
      const sku = String(li.item_sku ?? li.model_sku ?? '')
      if (!sku) continue
      const qty = num(li.model_quantity_purchased) || 1
      const unitPrice = num(li.model_discounted_price) || num(li.model_original_price)
      const a = bySku.get(sku) ?? { sku, name: li.item_name, gmv: 0, qty: 0 }
      a.gmv += unitPrice * qty
      a.qty += qty
      if (!a.name && li.item_name) a.name = li.item_name
      bySku.set(sku, a)
    }
  }
  return finish(bySku, catalog, netRatio)
}
