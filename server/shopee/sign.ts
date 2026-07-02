// Shopee Open API v2 request signing. DIFFERENT from TikTok: no path-param
// concatenation — the base is a fixed field order, keyed by the partner_key.
// Only this server-side module holds partner_key; the browser never signs.

import crypto from 'node:crypto'

export interface ShopeeSignInput {
  partnerId: string | number
  partnerKey: string
  /** API path, e.g. "/api/v2/order/get_order_list". */
  path: string
  /** Unix SECONDS. */
  timestamp: number
  accessToken: string
  shopId: string | number
}

/**
 * Shop-level signature (Shopee Open API v2):
 *   base = partner_id + api_path + timestamp + access_token + shop_id   (concat)
 *   sign = HMAC_SHA256(key=partner_key, msg=base) as lowercase hex.
 */
export function sign(input: ShopeeSignInput): string {
  const { partnerId, partnerKey, path, timestamp, accessToken, shopId } = input
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

/**
 * Build the common signed query params every shop-level call needs:
 * partner_id, timestamp, access_token, shop_id, sign.
 */
export function signedCommon(
  partnerId: string | number,
  partnerKey: string,
  path: string,
  accessToken: string,
  shopId: string | number,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const s = sign({ partnerId, partnerKey, path, timestamp, accessToken, shopId })
  return {
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign: s,
  }
}
