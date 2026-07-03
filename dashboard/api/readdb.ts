// Read-only SQLite access for the dashboard data tables (daily_data / snapshot_data /
// raw_orders / recon_cache). A SEPARATE read-only connection from the config store, so
// the read path needs no decryption key and never writes. The poller (old server) is
// the only writer; busy_timeout lets reads wait out its brief write locks.
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DailyRow } from '../src/data/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DASH_DB_PATH ?? path.join(__dirname, '../../server/store/data/costs.db')

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
db.pragma('busy_timeout = 5000')

export interface ResolvedShop {
  id: number
  platform: string
  mode: string
}

/** Active shops for a platform under a brand ('group' = every active shop). No creds needed. */
export function resolveShops(platform: string, brand: string): ResolvedShop[] {
  if (brand === 'group') {
    return db
      .prepare('SELECT id, platform, mode FROM shops WHERE platform = ? AND active = 1')
      .all(platform) as ResolvedShop[]
  }
  return db
    .prepare('SELECT id, platform, mode FROM shops WHERE platform = ? AND active = 1 AND brand_key = ?')
    .all(platform, brand) as ResolvedShop[]
}

/** Normalized daily rows for a shop/platform over [start, end] (inclusive). */
export function loadDailyRows(shopId: number, platform: string, start: string, end: string): DailyRow[] {
  const rows = db
    .prepare('SELECT data FROM daily_data WHERE shop_id=? AND platform=? AND date>=? AND date<=? ORDER BY date')
    .all(shopId, platform, start, end) as Array<{ data: string }>
  return rows.map((r) => JSON.parse(r.data) as DailyRow)
}

/** Exact-period snapshot (campaigns/creators/top_products), or null if not present. */
export function loadSnapshotExact<T>(shopId: number, platform: string, type: string, period: string): T[] | null {
  const r = db
    .prepare('SELECT data FROM snapshot_data WHERE shop_id=? AND platform=? AND type=? AND period=?')
    .get(shopId, platform, type, period) as { data: string } | undefined
  return r ? (JSON.parse(r.data) as T[]) : null
}

/** Most-recently-fetched snapshot of a type (fallback when no exact-period match). */
export function loadSnapshotLatest<T>(shopId: number, platform: string, type: string): T[] | null {
  const r = db
    .prepare('SELECT data FROM snapshot_data WHERE shop_id=? AND platform=? AND type=? ORDER BY fetched_at DESC LIMIT 1')
    .get(shopId, platform, type) as { data: string } | undefined
  return r ? (JSON.parse(r.data) as T[]) : null
}

/** Raw stored orders for a shop/platform over [start, end] (create_date). */
export function loadRawOrders<T>(shopId: number, platform: string, start: string, end: string): T[] {
  const rows = db
    .prepare('SELECT data FROM raw_orders WHERE shop_id=? AND platform=? AND create_date>=? AND create_date<=?')
    .all(shopId, platform, start, end) as Array<{ data: string }>
  return rows.map((r) => JSON.parse(r.data) as T)
}

/** Pre-normalized reconciliation orders (whole rolling window), or null. */
export function loadReconCache<T>(shopId: number, platform: string): T[] | null {
  const r = db
    .prepare('SELECT data FROM recon_cache WHERE shop_id=? AND platform=?')
    .get(shopId, platform) as { data: string } | undefined
  return r ? (JSON.parse(r.data) as T[]) : null
}
