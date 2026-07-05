// Normalization: Shopee raw order details + escrow -> domain DailyRow[]. SHARED
// by BOTH sample mode (fixtures) and live mode (signed API), so sample exercises
// the real normalization code path, not a shortcut.

import type {
  AdsCampaignRow,
  AdsDailyRow,
  Campaign,
  Catalog,
  DailyAdSpend,
  DailyRow,
  Fees,
  OrderDetail,
  OrderIncome,
  ProductPerf,
  ReconOrder,
} from './types'
import { FEE_KEYS } from './types'

function num(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function blankFees(): Fees {
  const f = {} as Fees
  FEE_KEYS.forEach((k) => (f[k] = 0))
  return f
}

/** Shopee shops here operate in Asia/Ho_Chi_Minh (UTC+7). Bucket by local day. */
const TZ_OFFSET_SEC = 7 * 3600

/** Unix SECONDS -> YYYY-MM-DD in Asia/Ho_Chi_Minh. */
export function dayOf(createTime: number): string {
  return new Date((createTime + TZ_OFFSET_SEC) * 1000).toISOString().slice(0, 10)
}

/** Convert a concrete YYYY-MM-DD to a days-ago offset relative to `today`. */
export function offsetOf(date: string, today: Date): number {
  const d = new Date(date + 'T00:00:00Z')
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return Math.round((t.getTime() - d.getTime()) / 86_400_000)
}

/**
 * Best-effort escrow -> normalized Fees. Each mapping has a // TODO confirm; any
 * missing field defaults to 0. Fees are absolute VND amounts per order.
 */
export function normalizeFees(income: OrderIncome): Fees {
  const fees = blankFees()
  // TODO confirm field name: platform commission fee.
  fees.commission_fee = Math.abs(num(income.commission_fee))
  // TODO confirm field name: payment / transaction fee (seller side).
  fees.payment_fee = Math.abs(num(income.seller_transaction_fee))
  // TODO confirm field name: value-added service fee.
  fees.service_fee = Math.abs(num(income.service_fee))
  // TODO confirm field name(s): seller-funded voucher (+ seller coin cashback).
  fees.seller_voucher = Math.abs(num(income.voucher_from_seller)) + Math.abs(num(income.seller_coin_cash_back))
  // TODO confirm field names: shipping cost borne by seller net of rebate + buyer-paid.
  fees.shipping_borne = Math.max(
    0,
    Math.abs(num(income.actual_shipping_fee)) -
      Math.abs(num(income.shopee_shipping_rebate)) -
      Math.abs(num(income.buyer_paid_shipping_fee)),
  )
  // TODO confirm field name: affiliate (AMS) commission; else 0.
  fees.affiliate_comm = Math.abs(num(income.order_ams_commission_fee))
  return fees
}

/** Shopee order_status values that count as cancelled / returned. */
function isCancelled(status: string): boolean {
  // TODO confirm exact status strings against the sandbox.
  return /CANCEL/i.test(status)
}
function isReturned(status: string): boolean {
  // TODO confirm exact status strings (RETURN / TO_RETURN / etc).
  return /RETURN/i.test(status)
}

interface DayAcc {
  gmv: number
  orders: number
  cancelled: number
  returned: number
  fees: Fees
  /** GMV các đơn có hoa hồng AMS (tiếp thị liên kết) trong escrow. */
  affGmv: number
}

/**
 * Build DailyRow[] from order details + escrow-by-order map. Groups by local day.
 * netRevenue nets platform/payment/service/voucher/shipping out of (gmv − cancelled
 * − returned); profit is recomputed so the P&L identity holds (residual = 0).
 */
export function normalizeDailySeries(
  orders: OrderDetail[],
  escrowByOrder: Map<string, OrderIncome>,
  today: Date = new Date(),
  adsByDay: Map<string, number> = new Map(),
): DailyRow[] {
  const byDay = new Map<string, DayAcc>()

  for (const o of orders) {
    const day = dayOf(num(o.create_time))
    if (!day) continue
    const amount = num(o.total_amount)
    const acc =
      byDay.get(day) ??
      ({ gmv: 0, orders: 0, cancelled: 0, returned: 0, fees: blankFees(), affGmv: 0 } as DayAcc)

    acc.gmv += amount
    acc.orders += 1
    if (isCancelled(o.order_status)) acc.cancelled += amount
    else if (isReturned(o.order_status)) acc.returned += amount

    const income = escrowByOrder.get(o.order_sn)
    if (income) {
      const f = normalizeFees(income)
      FEE_KEYS.forEach((k) => (acc.fees[k] += f[k]))
      // Đơn có hoa hồng AMS = đơn từ Tiếp thị liên kết (nguồn thật duy nhất
      // Shopee API tách được; Live/Video không có endpoint → gộp Thẻ sản phẩm).
      if (num(income.order_ams_commission_fee) > 0) acc.affGmv += amount
    }
    byDay.set(day, acc)
  }

  const rows: DailyRow[] = []
  for (const [date, acc] of byDay) {
    const gmvNet0 = Math.max(0, acc.gmv - acc.cancelled - acc.returned)
    const netRevenue =
      gmvNet0 -
      acc.fees.commission_fee -
      acc.fees.payment_fee -
      acc.fees.service_fee -
      acc.fees.seller_voucher -
      acc.fees.shipping_borne
    // `ads` is now real: per-day CPC spend from the Shopee ads module, injected by
    // date (days with no spend -> 0). profit is recomputed so the P&L identity holds.
    // TODO still not sourced: cogs (internal cost), kocBooking (internal booking store).
    const ads = adsByDay.get(date) ?? 0
    const cogs = 0
    const kocBooking = 0
    const profit = netRevenue - cogs - ads - acc.fees.affiliate_comm - kocBooking

    rows.push({
      date,
      off: offsetOf(date, today),
      gmv: acc.gmv,
      orders: acc.orders,
      gmvNet0,
      netRevenue,
      ads,
      cogs,
      kocBooking,
      profit,
      // TODO impressions/clicks are ad-platform metrics; not from order/escrow. 0.
      impressions: 0,
      clicks: 0,
      cancelled: acc.cancelled,
      returned: acc.returned,
      fees: acc.fees,
      // Tiếp thị liên kết = thật (đơn có AMS trong escrow); Live/Video: API không
      // tách → phần còn lại quy về Thẻ sản phẩm.
      sources: {
        live: 0,
        video: 0,
        card: Math.max(0, acc.gmv - acc.affGmv),
        search: 0,
        affiliate: acc.affGmv,
      },
    })
  }

  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** dd-mm-yyyy (Shopee ads) -> YYYY-MM-DD; passes through if already ISO. */
function adsDate(s: string | undefined): string {
  const str = String(s ?? '')
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  const m = str.match(/^(\d{2})-(\d{2})-(\d{4})/) // dd-mm-yyyy
  return m ? `${m[3]}-${m[2]}-${m[1]}` : str
}

/**
 * Shopee daily CPC ads performance -> {date, adSpend}[] (spend <- expense).
 * TODO confirm `expense` is the spend metric and dates are dd-mm-yyyy.
 */
export function normalizeShopeeDailySpend(rows: AdsDailyRow[]): DailyAdSpend[] {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const date = adsDate(r.date)
    if (!date) continue
    byDay.set(date, (byDay.get(date) ?? 0) + num(r.expense)) // TODO confirm 'expense'
  }
  return [...byDay.entries()]
    .map(([date, adSpend]) => ({ date, adSpend }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Shopee campaign-level CPC performance -> Campaign[] (platform:'shopee').
 * Rows may be per-day per-campaign, so we aggregate by campaign_id.
 *   spend<-expense, impressions<-impression, clicks, ctr as fraction,
 *   cpm=expense/impression*1000, gmv<-broad_gmv (TODO direct vs broad),
 *   roas=gmv/expense. `share` = campaign gmv / total gmv.
 */
export function normalizeShopeeCampaigns(rows: AdsCampaignRow[], brand: string): Campaign[] {
  interface Agg {
    id: string
    name?: string
    spend: number
    impressions: number
    clicks: number
    gmv: number
    conversions: number
  }
  const byId = new Map<string, Agg>()
  for (const r of rows) {
    const id = String(r.campaign_id)
    if (!id) continue
    const a =
      byId.get(id) ??
      { id, name: r.campaign_name, spend: 0, impressions: 0, clicks: 0, gmv: 0, conversions: 0 }
    a.spend += num(r.expense) // TODO confirm 'expense'
    a.impressions += num(r.impression) // TODO confirm 'impression'
    a.clicks += num(r.clicks)
    a.gmv += num(r.broad_gmv) // TODO confirm broad vs direct gmv
    a.conversions += num(r.broad_order) || num(r.direct_order) // TODO confirm broad vs direct order
    if (!a.name && r.campaign_name) a.name = r.campaign_name
    byId.set(id, a)
  }
  return [...byId.values()]
    .map((a) => {
      const ctr = a.impressions ? a.clicks / a.impressions : 0
      const cpc = a.clicks ? a.spend / a.clicks : 0
      const cpm = a.impressions ? (a.spend / a.impressions) * 1000 : 0
      const roas = a.spend ? a.gmv / a.spend : 0
      return {
        id: a.id,
        // TODO campaign name often unavailable from the perf endpoint; fall back.
        name: a.name ?? `Campaign ${a.id}`,
        brand, // TODO no brand dim in the report; caller-scoped brand is stamped here
        platform: 'shopee' as const,
        // TODO Shopee CPC campaigns don't expose an ad-format/type here.
        type: 'CPC',
        spend: a.spend,
        gmv: a.gmv,
        roas,
        impressions: a.impressions,
        ctr,
        clicks: a.clicks,
        cpc,
        cpm,
        conversions: a.conversions,
      }
    })
    .sort((x, y) => y.spend - x.spend)
}

type Item = NonNullable<OrderDetail['item_list']>[number]
function itemSku(li: Item): string {
  return String(li.item_sku ?? li.model_sku ?? '') // TODO confirm sku field
}
function itemUnitPrice(li: Item): number {
  return num(li.model_discounted_price) || num(li.model_original_price)
}

/**
 * Aggregate order item_list by SKU -> ProductPerf[]. gmv = Σ unit_price × qty,
 * qty = Σ quantities. marginPct = (gmv × netRatio − qty × unitCost) / gmv.
 * share = gmv / Σ gmv. TODO confirm item field names.
 */
export function normalizeTopProducts(
  orders: OrderDetail[],
  catalog: Catalog,
  netRatio: number,
): ProductPerf[] {
  interface Agg {
    sku: string
    name?: string
    gmv: number
    qty: number
  }
  const bySku = new Map<string, Agg>()
  for (const o of orders) {
    if (isCancelled(o.order_status) || isReturned(o.order_status)) continue
    for (const li of o.item_list ?? []) {
      const sku = itemSku(li)
      if (!sku) continue
      const qty = num(li.model_quantity_purchased) || 1
      const gmv = itemUnitPrice(li) * qty
      const a = bySku.get(sku) ?? { sku, name: li.item_name, gmv: 0, qty: 0 }
      a.gmv += gmv
      a.qty += qty
      if (!a.name && li.item_name) a.name = li.item_name
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

function shopeeSettled(status: string): boolean {
  // TODO confirm settled vs pending payout status from escrow/order.
  return /COMPLETED|SETTLED|PAID/i.test(status)
}

/**
 * Orders + escrow -> ReconOrder[]. One row per order; fees from escrow (9
 * normalized), net = escrow_amount when present else gmv − Σ fees, isSettled from
 * order/escrow status. TODO confirm settlement status + escrow_amount semantics.
 */
export function normalizeReconOrders(
  orders: OrderDetail[],
  escrowByOrder: Map<string, OrderIncome>,
  catalog: Catalog,
): ReconOrder[] {
  return orders
    .map((o) => {
      const income = escrowByOrder.get(o.order_sn)
      const fees = income ? normalizeFees(income) : blankFees()
      const gmv = num(o.total_amount)
      const li = (o.item_list ?? [])[0]
      const sku = li ? itemSku(li) : ''
      const cat = catalog.get(sku)
      const qty = (o.item_list ?? []).reduce((s, x) => s + (num(x.model_quantity_purchased) || 1), 0) || 1
      // Đơn nhiều sản phẩm: gộp đủ item_list theo tên (trước đây chỉ lấy item đầu).
      const itemAgg = new Map<string, number>()
      for (const x of o.item_list ?? []) {
        const name = x.item_name ?? itemSku(x)
        itemAgg.set(name, (itemAgg.get(name) ?? 0) + (num(x.model_quantity_purchased) || 1))
      }
      const items = [...itemAgg.entries()].map(([name, n]) => ({ name, qty: n }))
      const escrowAmt = income ? num(income.escrow_amount) : 0
      const net = escrowAmt || gmv - FEE_KEYS.reduce((s, k) => s + fees[k], 0)
      return {
        id: o.order_sn,
        platform: 'shopee' as const,
        brand: cat?.brand ?? 'nonelab',
        date: dayOf(num(o.create_time)),
        sku,
        product: li?.item_name ?? cat?.name ?? sku,
        qty,
        gmv,
        fees,
        net,
        isSettled: shopeeSettled(o.order_status) && escrowAmt > 0,
        ...(items.length > 1 ? { items } : {}),
      }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
