// Deterministic mock data generator — faithful port of the prototype's data.js.
// Restructured so every generator works on a SINGLE platform, so the MockConnector
// can implement the per-platform PlatformConnector slot. The DataRepository sums
// per-platform results, which is numerically identical to the prototype's combined
// path (all aggregate fields are additive and profit is recomputed linearly).

import type {
  Aggregate,
  Booking,
  Campaign,
  Creator,
  DailyRow,
  Fees,
  Period,
  Platform,
  Product,
  ProductPerf,
  ReconOrder,
  Sources,
} from '../../types'
import { FEE_KEYS } from '../../types'

// ---------- deterministic PRNG ----------
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TODAY = new Date(2026, 6, 2) // 2 Jul 2026
const DAYS = 190

function dateOf(offset: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - offset)
  return d
}
function iso(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

// ---------- brands ----------
export interface BrandDef {
  id: string
  name: string
  share: number
  adsF: number
  cogsF: number
}
export const BRANDS: BrandDef[] = [
  { id: 'nonelab', name: 'Nonelab', share: 0.46, adsF: 0.95, cogsF: 1.0 },
  { id: 'lumiere', name: 'Lumière', share: 0.33, adsF: 1.15, cogsF: 1.08 },
  { id: 'herbario', name: 'Herbario', share: 0.21, adsF: 0.85, cogsF: 0.94 },
]

interface Factors {
  share: number
  adsF: number
  cogsF: number
}
function factors(brand: string | undefined): Factors {
  if (!brand || brand === 'group') {
    let adsF = 0
    let cogsF = 0
    BRANDS.forEach((b) => {
      adsF += b.share * b.adsF
      cogsF += b.share * b.cogsF
    })
    return { share: 1, adsF, cogsF }
  }
  return BRANDS.find((x) => x.id === brand) || { share: 1, adsF: 1, cogsF: 1 }
}
function brandSeed(brand: string | undefined): number {
  if (!brand || brand === 'group') return 0
  return BRANDS.findIndex((b) => b.id === brand) + 1
}

// ---------- dimensions ----------
export const PRODUCTS: Product[] = [
  { sku: 'NL-SRM-30', brand: 'nonelab', name: 'Serum B5 Phục hồi 30ml', cost: 62000, price: 189000 },
  { sku: 'NL-KEM-50', brand: 'nonelab', name: 'Kem dưỡng Ceramide 50g', cost: 78000, price: 249000 },
  { sku: 'NL-SRM-B3', brand: 'nonelab', name: 'Serum Niacinamide 10% 30ml', cost: 55000, price: 169000 },
  { sku: 'NL-TAY-150', brand: 'nonelab', name: 'Tẩy trang Micellar 150ml', cost: 32000, price: 99000 },
  { sku: 'NL-CHO-100', brand: 'nonelab', name: 'Sữa rửa mặt Amino 100g', cost: 38000, price: 129000 },
  { sku: 'NL-MAT-60', brand: 'nonelab', name: 'Mặt nạ ngủ Peptide 60g', cost: 52000, price: 179000 },
  { sku: 'NL-CC-30', brand: 'nonelab', name: 'Kem chống nắng SPF50 30g', cost: 68000, price: 215000 },
  { sku: 'NL-SET-3', brand: 'nonelab', name: 'Set Phục hồi da 3 món', cost: 156000, price: 439000 },
  { sku: 'LM-SON-01', brand: 'lumiere', name: 'Son kem lì Velvet 04', cost: 42000, price: 159000 },
  { sku: 'LM-CUSH-02', brand: 'lumiere', name: 'Cushion Glow SPF35', cost: 88000, price: 265000 },
  { sku: 'LM-MASC-03', brand: 'lumiere', name: 'Mascara Longwear', cost: 46000, price: 155000 },
  { sku: 'LM-PHAN-04', brand: 'lumiere', name: 'Phấn phủ kiềm dầu', cost: 52000, price: 185000 },
  { sku: 'LM-KE-05', brand: 'lumiere', name: 'Kẻ mắt nước 24h', cost: 30000, price: 115000 },
  { sku: 'HB-DAU-01', brand: 'herbario', name: 'Dầu gội thảo mộc 300ml', cost: 48000, price: 165000 },
  { sku: 'HB-XA-02', brand: 'herbario', name: 'Xả bưởi 300ml', cost: 45000, price: 155000 },
  { sku: 'HB-TAM-03', brand: 'herbario', name: 'Sữa tắm gừng 400ml', cost: 42000, price: 145000 },
  { sku: 'HB-TINH-04', brand: 'herbario', name: 'Tinh dầu bưởi 50ml', cost: 35000, price: 135000 },
  { sku: 'HB-KEM-05', brand: 'herbario', name: 'Kem tay cúc La Mã', cost: 26000, price: 95000 },
]

interface CreatorDef {
  id: string
  name: string
  brand: string
  platform: Platform
  follows: string
  tier: string
}
const CREATORS: CreatorDef[] = [
  { id: 'koc01', name: 'Linh Skincare', brand: 'nonelab', platform: 'tiktok', follows: '812K', tier: 'Macro' },
  { id: 'koc02', name: 'Bác sĩ Da liễu Hà', brand: 'nonelab', platform: 'tiktok', follows: '1,2M', tier: 'Macro' },
  { id: 'koc03', name: 'Mai Review', brand: 'lumiere', platform: 'tiktok', follows: '324K', tier: 'Mid' },
  { id: 'koc04', name: 'Skincare cùng Tú', brand: 'nonelab', platform: 'tiktok', follows: '178K', tier: 'Mid' },
  { id: 'koc05', name: 'Chi Beauty Log', brand: 'lumiere', platform: 'tiktok', follows: '96K', tier: 'Micro' },
  { id: 'koc06', name: 'Hana Đánh giá', brand: 'herbario', platform: 'shopee', follows: '215K', tier: 'Mid' },
  { id: 'koc07', name: 'Shop cùng Ngân', brand: 'nonelab', platform: 'shopee', follows: '142K', tier: 'Mid' },
  { id: 'koc08', name: 'Duyên Unbox', brand: 'lumiere', platform: 'shopee', follows: '68K', tier: 'Micro' },
  { id: 'koc09', name: 'Ăn gì mua gì', brand: 'herbario', platform: 'shopee', follows: '450K', tier: 'Macro' },
  { id: 'koc10', name: 'Trâm Cosmetic', brand: 'herbario', platform: 'tiktok', follows: '54K', tier: 'Micro' },
]

interface CampaignDef {
  id: string
  name: string
  brand: string
  platform: Platform
  type: string
}
const CAMPAIGNS: CampaignDef[] = [
  { id: 'cp01', name: 'GMV Max – Serum B5', brand: 'nonelab', platform: 'tiktok', type: 'GMV Max' },
  { id: 'cp02', name: 'Video Shopping – Set Phục hồi', brand: 'nonelab', platform: 'tiktok', type: 'VSA' },
  { id: 'cp03', name: 'LIVE Boost – Mega Live 7.7', brand: 'nonelab', platform: 'tiktok', type: 'LIVE' },
  { id: 'cp04', name: 'Tìm kiếm SP – Serum B5', brand: 'nonelab', platform: 'shopee', type: 'Search' },
  { id: 'cp05', name: 'Quảng cáo Shop – Nonelab Official', brand: 'nonelab', platform: 'shopee', type: 'Shop Ads' },
  { id: 'cp06', name: 'GMV Max – Son Velvet', brand: 'lumiere', platform: 'tiktok', type: 'GMV Max' },
  { id: 'cp07', name: 'LIVE Boost – Lumière Beauty Day', brand: 'lumiere', platform: 'tiktok', type: 'LIVE' },
  { id: 'cp08', name: 'Tìm kiếm SP – Cushion Glow', brand: 'lumiere', platform: 'shopee', type: 'Search' },
  { id: 'cp09', name: 'Video Shopping – Dầu gội thảo mộc', brand: 'herbario', platform: 'tiktok', type: 'VSA' },
  { id: 'cp10', name: 'Khám phá – Combo tắm gội', brand: 'herbario', platform: 'shopee', type: 'Discovery' },
  { id: 'cp11', name: 'Quảng cáo Shop – Herbario Official', brand: 'herbario', platform: 'shopee', type: 'Shop Ads' },
]

// ---------- daily facts (raw, per platform) ----------
interface RawDay {
  gmv: number
  orders: number
  cancelRate: number
  returnRate: number
  gmvNet0: number
  fees: Fees
  netRevenue: number
  ads: number
  cogs: number
  kocBooking: number
  profit: number
  sources: Sources
  impressions: number
  clicks: number
}
interface DayRecord {
  date: string
  d: Date
  off: number
  tiktok: RawDay
  shopee: RawDay
}

const rand = mulberry32(20260702)
const days: DayRecord[] = []
for (let off = DAYS - 1; off >= 0; off--) {
  const d = dateOf(off)
  const dow = d.getDay()
  const wk = dow === 0 || dow === 6 ? 1.18 : 1.0
  const dd = d.getDate()
  let spike = 1
  if (dd === d.getMonth() + 1) spike = 2.6
  else if (dd === 15) spike = 1.5
  else if (dd === 25) spike = 1.35
  const growth = 1 + (DAYS - off) * 0.0022

  const mk = (platform: Platform): RawDay => {
    const base = platform === 'tiktok' ? 96e6 : 68e6
    const noise = 0.78 + rand() * 0.5
    const gmv = base * wk * spike * growth * noise
    const aov = platform === 'tiktok' ? 172000 : 158000
    const orders = Math.round(gmv / (aov * (0.92 + rand() * 0.16)))
    const cancelRate = 0.028 + rand() * 0.02
    const returnRate = 0.021 + rand() * 0.018
    const gmvNet0 = gmv * (1 - cancelRate - returnRate)

    const r =
      platform === 'tiktok'
        ? {
            commission: 0.045,
            payment: 0.05,
            service: 0.018,
            voucher: 0.028 + rand() * 0.012,
            shipping: 0.014 + rand() * 0.008,
            affiliate: 0.062 + rand() * 0.02,
          }
        : {
            commission: 0.0785,
            payment: 0.045,
            service: 0.06,
            voucher: 0.024 + rand() * 0.012,
            shipping: 0.018 + rand() * 0.01,
            affiliate: 0.045 + rand() * 0.018,
          }

    const fees: Fees = {
      commission_fee: gmvNet0 * r.commission,
      payment_fee: gmvNet0 * r.payment,
      service_fee: gmvNet0 * r.service,
      seller_voucher: gmvNet0 * r.voucher,
      shipping_borne: gmvNet0 * r.shipping,
      affiliate_comm: gmvNet0 * r.affiliate,
    }
    const netRevenue =
      gmvNet0 -
      fees.commission_fee -
      fees.payment_fee -
      fees.service_fee -
      fees.seller_voucher -
      fees.shipping_borne

    const roasT = platform === 'tiktok' ? 3.4 + rand() * 2.4 : 4.2 + rand() * 2.6
    const ads = (gmv * 0.62) / roasT
    const cogs = gmvNet0 * (0.315 + rand() * 0.02)
    const kocBooking =
      (spike > 2 ? 28e6 : dd % 9 === 0 ? 9e6 : 2.4e6) * (platform === 'tiktok' ? 1.25 : 0.6)
    const profit = netRevenue - cogs - ads - fees.affiliate_comm - kocBooking

    const src =
      platform === 'tiktok'
        ? { live: 0.36 + rand() * 0.08, video: 0.3 + rand() * 0.06, card: 0.14, search: 0.1 }
        : { live: 0.07 + rand() * 0.03, video: 0.05, card: 0.42 + rand() * 0.06, search: 0.34 + rand() * 0 }
    const srcSum = src.live + src.video + src.card + src.search

    const impressions = Math.round(((ads / (platform === 'tiktok' ? 38 : 55)) * 1000) / 22)
    const clicks = Math.round(impressions * (0.012 + rand() * 0.014))

    return {
      gmv,
      orders,
      cancelRate,
      returnRate,
      gmvNet0,
      fees,
      netRevenue,
      ads,
      cogs,
      kocBooking,
      profit,
      sources: {
        live: src.live / srcSum,
        video: src.video / srcSum,
        card: src.card / srcSum,
        search: src.search / srcSum,
      },
      impressions,
      clicks,
    }
  }

  days.push({ date: iso(d), d, off, tiktok: mk('tiktok'), shopee: mk('shopee') })
}

// ---------- aggregation (single platform) ----------
function blank(): Aggregate {
  const fees = {} as Fees
  FEE_KEYS.forEach((k) => (fees[k] = 0))
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
    fees,
    sources: { live: 0, video: 0, card: 0, search: 0 },
    marginPct: 0,
    roas: 0,
    cir: 0,
    aov: 0,
  }
}
function addInto(acc: Aggregate, x: RawDay): void {
  acc.gmv += x.gmv
  acc.orders += x.orders
  acc.gmvNet0 += x.gmvNet0
  acc.netRevenue += x.netRevenue
  acc.ads += x.ads
  acc.cogs += x.cogs
  acc.kocBooking += x.kocBooking
  acc.profit += x.profit
  acc.impressions += x.impressions
  acc.clicks += x.clicks
  acc.cancelled += x.gmv * x.cancelRate
  acc.returned += x.gmv * x.returnRate
  FEE_KEYS.forEach((k) => (acc.fees[k] += x.fees[k]))
  ;(['live', 'video', 'card', 'search'] as const).forEach(
    (s) => (acc.sources[s] += x.gmv * x.sources[s]),
  )
}
// Scale an aggregate by brand factors and recompute profit consistently.
function applyBrand(acc: Aggregate, brand: string | undefined): Aggregate {
  const f = factors(brand)
  const s = f.share
  acc.gmv *= s
  acc.orders = Math.round(acc.orders * s)
  acc.gmvNet0 *= s
  acc.netRevenue *= s
  acc.kocBooking *= s
  acc.impressions = Math.round(acc.impressions * s)
  acc.clicks = Math.round(acc.clicks * s)
  acc.cancelled *= s
  acc.returned *= s
  FEE_KEYS.forEach((k) => (acc.fees[k] *= s))
  ;(['live', 'video', 'card', 'search'] as const).forEach((k) => (acc.sources[k] *= s))
  acc.ads = acc.ads * s * f.adsF
  acc.cogs = acc.cogs * s * f.cogsF
  acc.profit = acc.netRevenue - acc.cogs - acc.ads - acc.fees.affiliate_comm - acc.kocBooking
  return acc
}

/** Single-platform aggregate over a window, brand-scaled. Derived KPIs left at 0
 *  (metrics.ts computes them on the merged aggregate). */
export function aggregateOne(
  platform: Platform,
  startOff: number,
  endOff: number,
  brand: string,
): Aggregate {
  const acc = blank()
  for (const row of days) {
    if (row.off > startOff || row.off < endOff) continue
    addInto(acc, row[platform])
  }
  applyBrand(acc, brand)
  return acc
}

export interface DailySeriesPoint {
  date: string
  d: Date
  gmv: number
  cost: number
  profit: number
  netRevenue: number
  ads: number
  orders: number
}

/** Per-day series for a single platform, brand-scaled. */
export function seriesOne(
  platform: Platform,
  startOff: number,
  endOff: number,
  brand: string,
): DailySeriesPoint[] {
  const out: DailySeriesPoint[] = []
  for (const row of days) {
    if (row.off > startOff || row.off < endOff) continue
    const acc = blank()
    addInto(acc, row[platform])
    applyBrand(acc, brand)
    const cost = acc.cogs + acc.ads + acc.kocBooking + FEE_KEYS.reduce((s, k) => s + acc.fees[k], 0)
    out.push({
      date: row.date,
      d: row.d,
      gmv: acc.gmv,
      cost,
      profit: acc.profit,
      netRevenue: acc.netRevenue,
      ads: acc.ads,
      orders: acc.orders,
    })
  }
  return out
}

/** Per-platform DailyRow list (normalized facts) for the connector API. */
export function dailyRowsOne(
  platform: Platform,
  startOff: number,
  endOff: number,
  brand: string,
): DailyRow[] {
  const out: DailyRow[] = []
  for (const row of days) {
    if (row.off > startOff || row.off < endOff) continue
    const acc = blank()
    addInto(acc, row[platform])
    applyBrand(acc, brand)
    out.push({
      date: row.date,
      off: row.off,
      gmv: acc.gmv,
      orders: acc.orders,
      gmvNet0: acc.gmvNet0,
      netRevenue: acc.netRevenue,
      ads: acc.ads,
      cogs: acc.cogs,
      kocBooking: acc.kocBooking,
      profit: acc.profit,
      impressions: acc.impressions,
      clicks: acc.clicks,
      cancelled: acc.cancelled,
      returned: acc.returned,
      fees: acc.fees,
      sources: acc.sources,
    })
  }
  return out
}

// ---------- periods ----------
export const PERIODS: Period[] = [
  { id: 'today', label: 'Hôm nay', cur: [0, 0], prev: [1, 1] },
  { id: 'yesterday', label: 'Hôm qua', cur: [1, 1], prev: [2, 2] },
  { id: '7d', label: '7 ngày', cur: [6, 0], prev: [13, 7] },
  { id: '30d', label: '30 ngày', cur: [29, 0], prev: [59, 30] },
  { id: 'mtd', label: 'Tháng này', cur: [1, 0], prev: [31, 30] },
  { id: 'quarter', label: 'Quý III', cur: [1, 0], prev: [92, 2] },
  { id: '90d', label: '90 ngày', cur: [89, 0], prev: [179, 90] },
]

// ---------- top products (single platform) ----------
export function topProductsOne(
  platform: Platform,
  startOff: number,
  endOff: number,
  brand: string,
): ProductPerf[] {
  const agg = aggregateOne(platform, startOff, endOff, brand)
  const pool = PRODUCTS.filter((p) => !brand || brand === 'group' || p.brand === brand)
  const rnd = mulberry32(
    777 + startOff * 31 + endOff + brandSeed(brand) * 97 + (platform === 'tiktok' ? 1 : 2),
  )
  const weights = pool.map((_, i) => 0.4 + rnd() * (i < 3 ? 2.2 : 1.2))
  const wsum = weights.reduce((a, b) => a + b, 0)
  return pool
    .map((p, i) => {
      const share = weights[i] / wsum
      const gmv = agg.gmv * share
      const qty = Math.round(gmv / p.price)
      const feeRate = 0.19
      const margin = (p.price * (1 - feeRate) - p.cost) / p.price
      return { ...p, gmv, qty, marginPct: margin, share }
    })
    .sort((a, b) => b.gmv - a.gmv)
}

// ---------- campaigns (single platform) ----------
export function campaignsOne(
  platform: Platform,
  startOff: number,
  endOff: number,
  brand: string,
): Campaign[] {
  const agg = aggregateOne(platform, startOff, endOff, brand)
  const list = CAMPAIGNS.filter(
    (c) => c.platform === platform && (!brand || brand === 'group' || c.brand === brand),
  )
  const rnd = mulberry32(555 + startOff * 17 + endOff + brandSeed(brand) * 71)
  const weights = list.map(() => 0.5 + rnd() * 1.8)
  const wsum = weights.reduce((a, b) => a + b, 0) || 1
  return list
    .map((c, i) => {
      const spend = agg.ads * (weights[i] / wsum)
      const roas =
        c.type === 'LIVE'
          ? 5.6 + rnd() * 2.5
          : c.type === 'Search'
            ? 6.2 + rnd() * 2.5
            : 2.6 + rnd() * 3.4
      const gmv = spend * roas
      const cpm = c.platform === 'tiktok' ? 32000 + rnd() * 18000 : 26000 + rnd() * 14000
      const impressions = (spend / cpm) * 1000
      const ctr = 0.011 + rnd() * 0.016
      const clicks = impressions * ctr
      const cpc = clicks ? spend / clicks : 0
      // Conversions: clicks × a plausible conversion rate (LIVE/Search convert higher).
      const cvr = c.type === 'LIVE' ? 0.09 + rnd() * 0.05 : c.type === 'Search' ? 0.08 + rnd() * 0.04 : 0.05 + rnd() * 0.035
      const conversions = clicks * cvr
      return { ...c, spend, gmv, roas, impressions, ctr, clicks, cpc, cpm, conversions }
    })
    .sort((a, b) => b.spend - a.spend)
}

// ---------- creators (single platform) ----------
export function creatorsOne(
  platform: Platform,
  startOff: number,
  endOff: number,
  brand: string,
): Creator[] {
  const agg = aggregateOne(platform, startOff, endOff, brand)
  const list = CREATORS.filter(
    (c) => c.platform === platform && (!brand || brand === 'group' || c.brand === brand),
  )
  const rnd = mulberry32(888 + startOff * 13 + endOff + brandSeed(brand) * 53)
  const weights = list.map(
    (c) => (c.tier === 'Macro' ? 2.6 : c.tier === 'Mid' ? 1.4 : 0.6) * (0.7 + rnd() * 0.6),
  )
  const wsum = weights.reduce((a, b) => a + b, 0) || 1
  const affPool = agg.fees.affiliate_comm
  const bookPool = agg.kocBooking
  return list
    .map((c, i) => {
      const share = weights[i] / wsum
      const gmv = agg.gmv * 0.34 * share
      const commission = affPool * share
      const booking =
        c.tier === 'Macro'
          ? bookPool * share * 2.4
          : c.tier === 'Mid'
            ? bookPool * share * 1.2
            : bookPool * share * 0.3
      const videos = Math.max(1, Math.round(2 + rnd() * 9))
      const cost = commission + booking
      const roi = cost ? gmv / cost : 0
      return { ...c, gmv, commission, booking, videos, cost, roi, share }
    })
    .sort((a, b) => b.gmv - a.gmv)
}

// ---------- reconciliation orders (single platform) ----------
export function reconOrdersOne(platform: Platform, brand: string): ReconOrder[] {
  const rnd = mulberry32(4242 + brandSeed(brand) * 29)
  const pool = PRODUCTS.filter((p) => !brand || brand === 'group' || p.brand === brand)
  const list: ReconOrder[] = []
  const statuses = [
    'settled',
    'settled',
    'settled',
    'pending',
    'pending',
    'settled',
    'settled',
    'pending',
    'settled',
    'settled',
  ]
  for (let i = 0; i < 42; i++) {
    const pf: Platform = i % 5 < 3 ? 'tiktok' : 'shopee'
    const p = pool[Math.floor(rnd() * pool.length)]
    const qty = 1 + Math.floor(rnd() * 3)
    const gmv = p.price * qty
    const offd = Math.floor(rnd() * 16)
    const isSettled = statuses[i % statuses.length] === 'settled' && offd > 6
    const r =
      pf === 'tiktok'
        ? {
            commission: 0.045,
            payment: 0.05,
            service: 0.018,
            voucher: 0.03,
            shipping: 0.016,
            affiliate: rnd() < 0.55 ? 0.07 : 0,
          }
        : {
            commission: 0.0785,
            payment: 0.045,
            service: 0.06,
            voucher: 0.026,
            shipping: 0.02,
            affiliate: rnd() < 0.3 ? 0.05 : 0,
          }
    const fees: Fees = {
      commission_fee: gmv * r.commission,
      payment_fee: gmv * r.payment,
      service_fee: gmv * r.service,
      seller_voucher: gmv * r.voucher,
      shipping_borne: gmv * r.shipping,
      affiliate_comm: gmv * r.affiliate,
    }
    const net = gmv - FEE_KEYS.reduce((s, k) => s + fees[k], 0)
    const oid = (pf === 'tiktok' ? '57' : '25') + String(680000 + Math.floor(rnd() * 300000))
    // The per-platform PRNG walk is consistent with the prototype's single 42-row
    // walk; the connector filters to its own platform after generation.
    if (pf !== platform) continue
    list.push({
      id: oid,
      platform: pf,
      brand: p.brand,
      date: iso(dateOf(offd)),
      sku: p.sku,
      product: p.name,
      qty,
      gmv,
      fees,
      net,
      isSettled,
    })
  }
  return list.sort((a, b) => (a.date < b.date ? 1 : -1))
}

// ---------- bookings (single platform) ----------
const BOOKINGS: Booking[] = [
  { creator: 'Bác sĩ Da liễu Hà', campaign: 'Mega Live 7.7', brand: 'nonelab', platform: 'tiktok', fee: 45e6, date: '2026-07-01', status: 'Đã ký' },
  { creator: 'Linh Skincare', campaign: 'Mega Live 7.7', brand: 'nonelab', platform: 'tiktok', fee: 30e6, date: '2026-06-28', status: 'Đã ký' },
  { creator: 'Ăn gì mua gì', campaign: 'Shopee 7.7 Sale', brand: 'herbario', platform: 'shopee', fee: 22e6, date: '2026-06-27', status: 'Đã ký' },
  { creator: 'Mai Review', campaign: 'Lumière Beauty Day', brand: 'lumiere', platform: 'tiktok', fee: 8e6, date: '2026-06-25', status: 'Đang đàm phán' },
  { creator: 'Hana Đánh giá', campaign: 'Shopee Video T7', brand: 'herbario', platform: 'shopee', fee: 6.5e6, date: '2026-06-24', status: 'Đã ký' },
  { creator: 'Skincare cùng Tú', campaign: 'Video seeding T7', brand: 'nonelab', platform: 'tiktok', fee: 5e6, date: '2026-06-22', status: 'Hoàn thành' },
]

export function bookingsOne(platform: Platform, brand: string): Booking[] {
  return BOOKINGS.filter(
    (b) => b.platform === platform && (brand === 'group' || b.brand === brand),
  )
}

export function productCatalog(): Product[] {
  return PRODUCTS.map((p) => ({ ...p }))
}

export { iso, TODAY }
