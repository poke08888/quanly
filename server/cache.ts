// Tiny in-memory response cache with in-flight de-duplication. The dashboard fires
// ~17 parallel requests per load, many hitting the same slow live TikTok endpoints;
// memo() collapses concurrent identical calls into one promise and serves repeat
// loads from cache for a short TTL, so live calls don't stack up past nginx's timeout.

const store = new Map<string, { exp: number; val: Promise<unknown> }>()

/**
 * Return a cached/in-flight promise for `key`, or start `fn()` and cache it for ttlMs.
 * Failures are NOT cached (evicted immediately) so a transient error can retry next time.
 */
export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.exp > now) return hit.val as Promise<T>
  const val = fn().catch((err) => {
    store.delete(key)
    throw err
  })
  store.set(key, { exp: now + ttlMs, val })
  // Opportunistic cleanup of expired entries so the map doesn't grow unbounded.
  if (store.size > 500) {
    for (const [k, v] of store) if (v.exp <= now) store.delete(k)
  }
  return val
}
