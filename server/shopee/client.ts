// Live Shopee Open API v2 client. Signs (via sign.ts) + calls order list / detail
// / escrow server-side, then hands raw shapes to the SAME normalize.ts used by
// sample mode. Only reached when SHOPEE_MODE=live.

import { signedCommon } from './sign'
import type {
  EscrowDetailResponse,
  OrderDetail,
  OrderDetailResponse,
  OrderIncome,
  OrderListResponse,
} from './types'

export interface ShopeeCreds {
  partnerId: string
  partnerKey: string
  accessToken: string
  shopId: string
  baseUrl: string
}

const ORDER_LIST_PATH = '/api/v2/order/get_order_list'
const ORDER_DETAIL_PATH = '/api/v2/order/get_order_detail'
const ESCROW_PATH = '/api/v2/payment/get_escrow_detail'

function buildUrl(creds: ShopeeCreds, path: string, extra: Record<string, string>): string {
  const common = signedCommon(
    creds.partnerId,
    creds.partnerKey,
    path,
    creds.accessToken,
    creds.shopId,
  )
  const qs = new URLSearchParams({ ...common, ...extra }).toString()
  return `${creds.baseUrl}${path}?${qs}`
}

async function get<T>(creds: ShopeeCreds, path: string, extra: Record<string, string>): Promise<T> {
  const res = await fetch(buildUrl(creds, path, extra), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shopee ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as T & { error?: string; message?: string }
  if (json.error) throw new Error(`Shopee ${path} error ${json.error}: ${json.message}`)
  return json
}

/** Max 15-day window per Shopee; chunk [from,to] (unix seconds) into ≤15-day spans. */
function chunkWindows(from: number, to: number): [number, number][] {
  const span = 15 * 86_400
  const out: [number, number][] = []
  let s = from
  while (s < to) {
    const e = Math.min(s + span, to)
    out.push([s, e])
    s = e
  }
  return out
}

/** List all order_sn in [timeFrom,timeTo] (unix seconds), paginating by cursor. */
async function listOrderSns(creds: ShopeeCreds, timeFrom: number, timeTo: number): Promise<string[]> {
  const sns: string[] = []
  for (const [from, to] of chunkWindows(timeFrom, timeTo)) {
    let cursor = ''
    let guard = 0
    for (;;) {
      const env = await get<OrderListResponse>(creds, ORDER_LIST_PATH, {
        time_range_field: 'create_time', // TODO confirm
        time_from: String(from),
        time_to: String(to),
        page_size: '100',
        cursor,
        // order_status: 'ALL', // TODO confirm optional param
      })
      for (const o of env.response.order_list ?? []) sns.push(o.order_sn)
      guard++
      if (!env.response.more || guard >= 200) break
      cursor = env.response.next_cursor
    }
  }
  return sns
}

/** Fetch order details in batches of ≤50 order_sn. */
async function fetchOrderDetails(creds: ShopeeCreds, sns: string[]): Promise<OrderDetail[]> {
  const out: OrderDetail[] = []
  for (let i = 0; i < sns.length; i += 50) {
    const batch = sns.slice(i, i + 50)
    const env = await get<OrderDetailResponse>(creds, ORDER_DETAIL_PATH, {
      order_sn_list: batch.join(','),
      response_optional_fields: 'total_amount,order_status,create_time,item_list',
    })
    out.push(...(env.response.order_list ?? []))
  }
  return out
}

/** Fetch escrow (order_income) per order_sn. */
async function fetchEscrow(creds: ShopeeCreds, sns: string[]): Promise<Map<string, OrderIncome>> {
  const map = new Map<string, OrderIncome>()
  for (const sn of sns) {
    // TODO consider get_escrow_detail_batch if enabled for the account.
    const env = await get<EscrowDetailResponse>(creds, ESCROW_PATH, { order_sn: sn })
    if (env.order_income) map.set(env.order_sn ?? sn, env.order_income)
  }
  return map
}

/**
 * Lightweight connection probe: a single signed get_order_list call. Validates
 * partner_id/partner_key/access_token/shop_id without pulling details/escrow.
 * Throws (with Shopee's message) on bad credentials; resolves otherwise.
 */
export async function pingOrders(
  creds: ShopeeCreds,
  timeFrom: number,
  timeTo: number,
): Promise<void> {
  await get<OrderListResponse>(creds, ORDER_LIST_PATH, {
    time_range_field: 'create_time',
    time_from: String(timeFrom),
    time_to: String(timeTo),
    page_size: '1',
  })
}

/** Full live pull: order_sns -> details + escrow. timeFrom/timeTo are unix seconds. */
export async function fetchOrdersAndEscrow(
  creds: ShopeeCreds,
  timeFrom: number,
  timeTo: number,
): Promise<{ orders: OrderDetail[]; escrow: Map<string, OrderIncome> }> {
  const sns = await listOrderSns(creds, timeFrom, timeTo)
  const [orders, escrow] = await Promise.all([
    fetchOrderDetails(creds, sns),
    fetchEscrow(creds, sns),
  ])
  return { orders, escrow }
}
