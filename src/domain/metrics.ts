// P&L / KPI derivation on the merged Aggregate.
// Preserves the exact P&L identity from data.js:
//   GMV = profit + COGS + ads + KOC(affiliate_comm + booking)
//         + (commission + payment + service) + (voucher + shipping) + (cancelled + returned)
// profit = netRevenue − cogs − ads − affiliate_comm − kocBooking  (netRevenue already nets
// commission/payment/service/voucher/shipping out of gmvNet0), and the residual vs GMV is
// the cancelled+returned bucket. All fields are additive across platforms, so summing
// per-platform aggregates then deriving here matches the prototype's combined path.

import type { Aggregate, DailyRow, Fees } from '../data/types'
import { FEE_KEYS } from '../data/types'

function blankFees(): Fees {
  const f = {} as Fees
  FEE_KEYS.forEach((k) => (f[k] = 0))
  return f
}

export function emptyAggregate(): Aggregate {
  return {
    gmv: 0,
    orders: 0,
    gmvNet0: 0,
    netRevenue: 0,
    ads: 0,
    cogs: 0,
    kocBooking: 0,
    profit: 0,
    impressions: 0,
    clicks: 0,
    cancelled: 0,
    returned: 0,
    fees: blankFees(),
    sources: { live: 0, video: 0, card: 0, search: 0 },
    marginPct: 0,
    roas: 0,
    cir: 0,
    aov: 0,
  }
}

/** Sum a set of DailyRows (already brand-scaled, single-or-multi platform) into an Aggregate. */
export function aggregateFromRows(rows: DailyRow[]): Aggregate {
  const acc = emptyAggregate()
  for (const r of rows) {
    acc.gmv += r.gmv
    acc.orders += r.orders
    acc.gmvNet0 += r.gmvNet0
    acc.netRevenue += r.netRevenue
    acc.ads += r.ads
    acc.cogs += r.cogs
    acc.kocBooking += r.kocBooking
    acc.profit += r.profit
    acc.impressions += r.impressions
    acc.clicks += r.clicks
    acc.cancelled += r.cancelled
    acc.returned += r.returned
    FEE_KEYS.forEach((k) => (acc.fees[k] += r.fees[k]))
    ;(['live', 'video', 'card', 'search'] as const).forEach(
      (s) => (acc.sources[s] += r.sources[s]),
    )
  }
  return withKpis(acc)
}

/** Merge already-computed aggregates (e.g. tiktok + shopee) into one. */
export function mergeAggregates(parts: Aggregate[]): Aggregate {
  const acc = emptyAggregate()
  for (const a of parts) {
    acc.gmv += a.gmv
    acc.orders += a.orders
    acc.gmvNet0 += a.gmvNet0
    acc.netRevenue += a.netRevenue
    acc.ads += a.ads
    acc.cogs += a.cogs
    acc.kocBooking += a.kocBooking
    acc.profit += a.profit
    acc.impressions += a.impressions
    acc.clicks += a.clicks
    acc.cancelled += a.cancelled
    acc.returned += a.returned
    FEE_KEYS.forEach((k) => (acc.fees[k] += a.fees[k]))
    ;(['live', 'video', 'card', 'search'] as const).forEach((s) => (acc.sources[s] += a.sources[s]))
  }
  return withKpis(acc)
}

/** Fill derived KPI fields. */
export function withKpis(acc: Aggregate): Aggregate {
  acc.marginPct = acc.gmv ? acc.profit / acc.gmv : 0
  acc.roas = acc.ads ? acc.gmv / acc.ads : 0
  acc.cir = acc.gmv ? (acc.ads + acc.fees.affiliate_comm + acc.kocBooking) / acc.gmv : 0
  acc.aov = acc.orders ? acc.gmv / acc.orders : 0
  return acc
}

export interface CostSegment {
  label: string
  value: number
  color: string
  txt: string
}

/** The 7-segment "1 đồng GMV đi đâu?" cost composition (muted palette). */
export function costComposition(a: Aggregate): CostSegment[] {
  const F = a.fees
  return [
    { label: 'Lợi nhuận', value: a.profit, color: '#3d8a6b', txt: '#ffffff' },
    { label: 'COGS (giá vốn)', value: a.cogs, color: '#8a7fa3', txt: '#ffffff' },
    {
      label: 'Phí sàn / TT / DV',
      value: F.commission_fee + F.payment_fee + F.service_fee,
      color: '#ad7d73',
      txt: '#ffffff',
    },
    { label: 'Ads', value: a.ads, color: '#6f89ac', txt: '#ffffff' },
    { label: 'KOC (HH + booking)', value: F.affiliate_comm + a.kocBooking, color: '#5ea08f', txt: '#ffffff' },
    { label: 'Voucher + Ship', value: F.seller_voucher + F.shipping_borne, color: '#a98a5c', txt: '#ffffff' },
    { label: 'Hoàn / hủy', value: a.cancelled + a.returned, color: '#9098a6', txt: '#ffffff' },
  ]
}
