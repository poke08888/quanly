// TikTok Shop Partner API v2 request signing.
// The browser must NEVER hold app_secret or call TikTok directly; only this
// server-side module signs requests. Algorithm per TikTok Partner API v2 docs.

import crypto from 'node:crypto'

// Some legacy TikTok examples uppercase the hex digest. The current v2 spec uses
// LOWERCASE hex. Flip this single constant if the sandbox rejects the signature.
const SIGN_HEX_UPPERCASE = false

export interface SignInput {
  /** App secret (server-only). Also used as the HMAC key. */
  appSecret: string
  /** Request path, e.g. "/analytics/202405/shop/performance". */
  path: string
  /** All query params that will be sent (may include app_key, timestamp, shop_cipher, …). */
  query: Record<string, string | number | undefined>
  /** Raw JSON body string, if the request has a (non-multipart) body. */
  body?: string
}

/**
 * Compute the TikTok Partner API v2 `sign`.
 *
 * Steps (from the spec):
 *  1. Take all query params EXCEPT `sign` and `access_token`.
 *  2. Sort remaining params by key (alphabetical, ASCII).
 *  3. Concatenate as key1value1key2value2… (no separators).
 *  4. Prepend the request path -> pathconcat.
 *  5. If a (non-multipart) body exists, append the raw JSON body string.
 *  6. Wrap with the app secret on both ends: signBase = appSecret + step5 + appSecret.
 *  7. sign = HMAC_SHA256(key=appSecret, msg=signBase) as lowercase hex.
 */
export function sign(input: SignInput): string {
  const { appSecret, path, query, body } = input

  // 1 + 2: filter out sign/access_token, sort by key (ASCII).
  const keys = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .filter((k) => query[k] !== undefined)
    .sort()

  // 3: concatenate key1value1key2value2…
  let base = keys.map((k) => `${k}${query[k]}`).join('')

  // 4: prepend the request path.
  base = `${path}${base}`

  // 5: append the raw body string, if any.
  if (body) base = `${base}${body}`

  // 6: wrap with the app secret on both ends.
  const signBase = `${appSecret}${base}${appSecret}`

  // 7: HMAC-SHA256 keyed by the app secret, hex digest.
  const digest = crypto.createHmac('sha256', appSecret).update(signBase).digest('hex')
  return SIGN_HEX_UPPERCASE ? digest.toUpperCase() : digest
}

/**
 * Build the fully-signed query object for a GET/POST call: adds `timestamp`
 * (unix SECONDS) and `sign`. `access_token` is sent as a header, not signed.
 */
export function signedQuery(
  appSecret: string,
  path: string,
  params: Record<string, string | number | undefined>,
  body?: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const withTs = { ...params, timestamp }
  const s = sign({ appSecret, path, query: withTs, body })
  const full = { ...withTs, sign: s }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(full)) {
    if (v !== undefined) out[k] = String(v)
  }
  return out
}
