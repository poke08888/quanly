// Server-side mirror of the domain types the BFF must emit. Kept in sync with
// src/data/types.ts (DailyRow, Fees, Sources). The BFF returns DailyRow[] JSON
// so the frontend TikTokConnector can pass it straight through.

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

export interface DailyRow {
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

// ---- Raw TikTok envelope shapes (as consumed by normalize.ts) ----

export interface TikTokMoney {
  amount: string | number
  currency: string
}

/** GET /analytics/202405/shop/performance */
export interface AnalyticsInterval {
  start_date: string
  end_date: string
  gmv: TikTokMoney
  sku_orders: number
  units_sold: number
  customers: number
  click_to_order_rate: number
  // Optional/best-effort extras the sandbox may include.
  impressions?: number
  page_views?: number
  cancelled_amount?: TikTokMoney
  returned_amount?: TikTokMoney
}

export interface AnalyticsEnvelope {
  code: number
  message: string
  data: {
    performance: {
      intervals: AnalyticsInterval[]
    }
  }
}

/** GET /finance/202309/statements (paginated). Field names are best-effort. */
export interface FinanceStatement {
  statement_id?: string
  // TODO confirm: the date field a statement is keyed on (statement_time vs
  // settlement/payment date). We use `statement_date` (YYYY-MM-DD) for daily bucketing.
  statement_date: string
  currency?: string
  // Fee breakdown — see normalizeFees() for the best-effort mapping + TODOs.
  [key: string]: unknown
}

export interface FinanceEnvelope {
  code: number
  message: string
  data: {
    statements: FinanceStatement[]
    next_page_token?: string
    total_count?: number
  }
}

// ---- Affiliate Seller API (not fully public — field names best-effort) ----

/** One affiliate order attributed to a creator. Field names are unverifiable until
 *  the Affiliate Seller scope is granted (probe 2026-07-05: version 202410 valid,
 *  call blocked by code 105005) — normalizeCreators extracts via candidate paths. */
export interface AffiliateOrder {
  order_id?: string
  create_time?: number | string
  [key: string]: unknown
}

export interface AffiliateOrdersEnvelope {
  code: number
  message: string
  data?: {
    orders?: AffiliateOrder[]
    next_page_token?: string
    total_count?: number
    [key: string]: unknown
  }
}

/** Mirror of src/data/types.ts Creator (kept in sync). */
export interface Creator {
  id: string
  name: string
  brand: string
  platform: 'tiktok' | 'shopee'
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

// ---- Shop products performance (GET /analytics/202405/shop_products/performance) ----

export interface ShopProduct {
  // TODO confirm exact field names/granularity for product performance.
  sku_id?: string // TODO confirm (seller SKU vs product id)
  seller_sku?: string
  product_name?: string
  gmv?: TikTokMoney
  units_sold?: number
  sku_orders?: number
}

export interface ShopProductsEnvelope {
  code: number
  message: string
  data: {
    products: ShopProduct[]
  }
}

// ---- Order search (GET /order/202309/orders/search) ----

export interface OrderLineItem {
  seller_sku?: string
  sku_id?: string
  product_name?: string
  quantity?: number
  // VND. TODO confirm which amount field is the line/subtotal.
  sale_price?: string | number
  original_price?: string | number
}

export interface SearchedOrder {
  id: string
  // TODO confirm status enum for settled/unsettled.
  status?: string
  create_time?: number
  // VND. TODO confirm order-total field name.
  payment?: { total_amount?: string | number }
  total_amount?: string | number
  line_items?: OrderLineItem[]
}

export interface OrderSearchEnvelope {
  code: number
  message: string
  data: {
    orders: SearchedOrder[]
    next_page_token?: string
    total_count?: number
  }
}

/** Mirror of src/data/types.ts ProductPerf (kept in sync). */
export interface ProductPerf {
  sku: string
  brand: string
  name: string
  cost: number
  price: number
  gmv: number
  qty: number
  marginPct: number
  share: number
}

/** Mirror of src/data/types.ts ReconOrder (kept in sync). */
export interface ReconOrder {
  id: string
  platform: 'tiktok' | 'shopee'
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
