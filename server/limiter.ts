// Global concurrency limiter for outbound TikTok calls. The dashboard fires ~17
// parallel BFF requests, each making 1-3 TikTok calls — firing 20+ concurrent
// requests at TikTok makes IT slow/rate-limit, pushing some past nginx's 30s timeout
// (→ 504). Capping concurrency keeps each call fast; the rest queue briefly.

const MAX = 4
let active = 0
const waiters: Array<() => void> = []

export async function limit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((resolve) => waiters.push(resolve))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}
