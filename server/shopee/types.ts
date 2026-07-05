// Server-side Shopee raw envelope shapes + domain mirror. DailyRow/Fees/Sources
// mirror src/data/types.ts (kept in sync). Field names are best-effort — see
// // TODO confirm markers where the sandbox must be checked.

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
  affiliate: number
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

// ---- Raw Shopee envelope shapes ----

/** GET /api/v2/order/get_order_list */
export interface OrderListResponse {
  error?: string
  message?: string
  response: {
    order_list: { order_sn: string }[]
    more: boolean
    next_cursor: string
  }
}

export interface OrderItem {
  model_quantity_purchased?: number
  // TODO confirm item field names for product aggregation.
  item_sku?: string
  model_sku?: string
  item_name?: string
  model_discounted_price?: number | string // VND unit price actually charged
  model_original_price?: number | string
}

export interface OrderDetail {
  order_sn: string
  /** VND. */
  total_amount: string | number
  /** Unix SECONDS. */
  create_time: number
  order_status: string
  item_list?: OrderItem[]
}

/** GET /api/v2/order/get_order_detail */
export interface OrderDetailResponse {
  error?: string
  message?: string
  response: {
    order_list: OrderDetail[]
  }
}

/** get_escrow_detail response.order_income — fee field names best-effort. */
export interface OrderIncome {
  escrow_amount?: number | string
  commission_fee?: number | string
  service_fee?: number | string
  seller_transaction_fee?: number | string
  voucher_from_seller?: number | string
  seller_coin_cash_back?: number | string
  buyer_paid_shipping_fee?: number | string
  actual_shipping_fee?: number | string
  shopee_shipping_rebate?: number | string
  order_ams_commission_fee?: number | string
  [key: string]: unknown
}

/** GET /api/v2/payment/get_escrow_detail (single order). Shopee v2 wraps the payload
 *  in `response` (same as order list/detail); flat fields kept as defensive fallback. */
export interface EscrowDetailResponse {
  response?: { order_sn?: string; order_income?: OrderIncome }
  order_sn?: string
  order_income?: OrderIncome
}

// ---- Shopee ads module (metric names best-effort) ----

/** get_all_cpc_ads_daily_performance -> daily_performance_list[] */
export interface AdsDailyRow {
  date: string // dd-mm-yyyy (TODO confirm) — normalized to YYYY-MM-DD
  impression?: number | string
  clicks?: number | string
  ctr?: number | string
  expense?: number | string
  broad_gmv?: number | string
  broad_order?: number | string
  direct_gmv?: number | string
  direct_order?: number | string
  cpc?: number | string
  [key: string]: unknown
}

/** get_product_campaign_daily_performance -> per campaign (may be per day). */
export interface AdsCampaignRow {
  campaign_id: string | number
  campaign_name?: string // TODO often absent; fall back to `Campaign {id}`
  date?: string
  impression?: number | string
  clicks?: number | string
  ctr?: number | string
  expense?: number | string
  broad_gmv?: number | string
  broad_order?: number | string
  direct_gmv?: number | string
  direct_order?: number | string
  cpc?: number | string
  [key: string]: unknown
}

/** Mirror of src/data/types.ts Campaign (kept in sync). */
export interface Campaign {
  id: string
  name: string
  brand: string
  platform: 'tiktok' | 'shopee'
  type: string
  spend: number
  gmv: number
  roas: number
  impressions: number
  ctr: number
  clicks: number
  cpc: number
  cpm: number
  conversions: number
}

/** Per-day ad spend, injected into DailyRow.ads by date. */
export interface DailyAdSpend {
  date: string
  adSpend: number
}

/** Catalog lookup (from the cost store) for margin + brand/name. */
export interface CatalogEntry {
  brand: string
  name: string
  price: number
  unitCost: number
}
export type Catalog = Map<string, CatalogEntry>

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
  /** Đơn nhiều sản phẩm: danh sách đầy đủ (chỉ ghi khi >1 sản phẩm để cache gọn). */
  items?: Array<{ name: string; qty: number }>
}
