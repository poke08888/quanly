// Domain types for the Nonelab dashboard data layer.
// The UI depends ONLY on these + DataRepository, never on a concrete connector.

export type Platform = 'tiktok' | 'shopee'
/** Platform filter used by the UI/repository. 'all' fans out to both. */
export type PlatformFilter = 'all' | Platform
/** 'group' means all brands combined. */
export type BrandId = 'group' | string

export interface Brand {
  id: string
  name: string
  share: number
  adsF: number
  cogsF: number
}

export interface Period {
  id: string
  label: string
  /** [startOffset, endOffset] in days-ago (start >= end). */
  cur: [number, number]
  prev: [number, number]
}

/** The 9 normalized fee fields (6 stored + 3 derived cost buckets live on Aggregate). */
export interface Fees {
  commission_fee: number
  payment_fee: number
  service_fee: number
  seller_voucher: number
  shipping_borne: number
  affiliate_comm: number
}

export const FEE_KEYS: (keyof Fees)[] = [
  'commission_fee',
  'payment_fee',
  'service_fee',
  'seller_voucher',
  'shipping_borne',
  'affiliate_comm',
]

export interface Sources {
  live: number
  video: number
  card: number
  search: number
}

/** One day of raw combined facts, per platform, already brand-scaled. */
export interface DailyRow {
  date: string
  /** ISO offset in days-ago (0 = today). */
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

/** Aggregate over a window. Numeric fields are additive across platforms. */
export interface Aggregate {
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
  // derived (metrics.ts fills these)
  marginPct: number
  roas: number
  cir: number
  aov: number
}

export interface Campaign {
  id: string
  name: string
  brand: string
  platform: Platform
  type: string
  spend: number
  gmv: number
  roas: number
  impressions: number
  ctr: number
  clicks: number
  cpc: number
  cpm: number
  /** Attributed conversions (for CVR = conversions / clicks). */
  conversions: number
}

export interface Creator {
  id: string
  name: string
  brand: string
  platform: Platform
  follows: string
  tier: string
  gmv: number
  commission: number
  booking: number
  videos: number
  cost: number
  roi: number
  share: number
}

export interface Product {
  sku: string
  brand: string
  name: string
  cost: number
  price: number
}

/** Product with performance figures for the top-products table. */
export interface ProductPerf extends Product {
  gmv: number
  qty: number
  marginPct: number
  share: number
}

export interface Booking {
  creator: string
  campaign: string
  brand: string
  platform: Platform
  fee: number
  date: string
  status: string
}

export interface ReconOrder {
  id: string
  platform: Platform
  brand: string
  date: string
  sku: string
  product: string
  qty: number
  gmv: number
  fees: Fees
  net: number
  isSettled: boolean
}
