// Persistence layer for the internal cost data (COGS by SKU + KOC bookings).
// SQLite via better-sqlite3 (synchronous). Seeds from the mock catalog/bookings on
// first run so the demo stays populated; data survives BFF restarts.

import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  SEED_BOOKINGS,
  SEED_KPI_BRANDS,
  SEED_KPI_MONTHS,
  SEED_KPI_YEAR,
  SEED_PRODUCTS,
  SEED_USERS,
  type UserChannel,
  type UserPlatform,
  type UserRole,
} from './seed'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DATA_DIR, 'costs.db')

export interface CogsRow {
  sku: string
  name: string
  brand: string
  price: number
  /** Current unit cost (editable). */
  unitCost: number
  /** ISO date the cost applies from. */
  effectiveDate: string
}

export interface BookingRow {
  id: number
  creator: string
  campaign: string
  brand: string
  platform: 'tiktok' | 'shopee'
  fee: number
  date: string
  status: string
}

export interface UserRow {
  id: number
  name: string
  email: string
  role: UserRole
  /** Sàn the user may view. */
  platforms: UserPlatform[]
  /** GMV channels/sources the user may view. */
  channels: UserChannel[]
  active: boolean
  /** True if a login password has been set. The hash is NEVER exposed. */
  hasPassword: boolean
}

export interface KpiMonthly {
  year: number
  /** Brand id these targets are for ('group' = element-wise sum across brands). */
  brand: string
  /** 12 monthly revenue targets (index 0 = Jan … 11 = Dec), VND. */
  months: number[]
}

mkdirSync(DATA_DIR, { recursive: true })
const db = new Database(DB_PATH)
// Durable per-commit: rollback journal + FULL sync means a committed write is in
// the main db file immediately (survives an abrupt process kill, no WAL to lose).
db.pragma('journal_mode = DELETE')
db.pragma('synchronous = FULL')

db.exec(`
  CREATE TABLE IF NOT EXISTS cogs (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    price INTEGER NOT NULL,
    unit_cost INTEGER NOT NULL,
    effective_date TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator TEXT NOT NULL,
    campaign TEXT NOT NULL,
    brand TEXT NOT NULL,
    platform TEXT NOT NULL,
    fee INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    platforms TEXT NOT NULL, -- JSON array of 'tiktok'|'shopee'
    channels TEXT NOT NULL,  -- JSON array of 'live'|'video'|'card'|'search'
    active INTEGER NOT NULL  -- 0|1
  );
  CREATE TABLE IF NOT EXISTS kpi_monthly (
    year INTEGER NOT NULL,
    month INTEGER NOT NULL, -- 1..12
    brand TEXT NOT NULL,    -- brand id (per-brand targets; 'group' is derived-sum, not stored)
    target REAL NOT NULL,
    PRIMARY KEY (year, month, brand)
  );
`)

// ---- guarded migrations (run AFTER CREATE TABLE so existing dbs upgrade cleanly) ----
/** ADD COLUMN only if it's missing (SQLite has no IF NOT EXISTS for columns). */
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}
// Login password (prototype): store a hash only, never plaintext. Nullable so
// existing users migrate with no password set.
addColumnIfMissing('users', 'password_hash', 'password_hash TEXT')

// KPI targets became PER-BRAND: the PK changed from (year,month) to (year,month,brand).
// SQLite can't alter a PK in place, so if an old (brand-less) kpi_monthly exists,
// drop + recreate with the new schema (prototype rows are discarded and reseeded).
{
  const kpiCols = db.prepare(`PRAGMA table_info(kpi_monthly)`).all() as Array<{ name: string }>
  if (kpiCols.length > 0 && !kpiCols.some((c) => c.name === 'brand')) {
    db.exec(`
      DROP TABLE kpi_monthly;
      CREATE TABLE kpi_monthly (
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        brand TEXT NOT NULL,
        target REAL NOT NULL,
        PRIMARY KEY (year, month, brand)
      );
    `)
  }
}

// ---- first-run seeding (only when empty) ----
const DEFAULT_EFFECTIVE = '2026-07-01'
const cogsCount = (db.prepare('SELECT COUNT(*) AS n FROM cogs').get() as { n: number }).n
if (cogsCount === 0) {
  const ins = db.prepare(
    'INSERT INTO cogs (sku, name, brand, price, unit_cost, effective_date) VALUES (?,?,?,?,?,?)',
  )
  const tx = db.transaction(() => {
    for (const p of SEED_PRODUCTS) ins.run(p.sku, p.name, p.brand, p.price, p.cost, DEFAULT_EFFECTIVE)
  })
  tx()
}
const bookingCount = (db.prepare('SELECT COUNT(*) AS n FROM bookings').get() as { n: number }).n
if (bookingCount === 0) {
  const ins = db.prepare(
    'INSERT INTO bookings (creator, campaign, brand, platform, fee, date, status) VALUES (?,?,?,?,?,?,?)',
  )
  const tx = db.transaction(() => {
    for (const b of SEED_BOOKINGS)
      ins.run(b.creator, b.campaign, b.brand, b.platform, b.fee, b.date, b.status)
  })
  tx()
}
const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
if (userCount === 0) {
  const ins = db.prepare(
    'INSERT INTO users (name, email, role, platforms, channels, active) VALUES (?,?,?,?,?,?)',
  )
  const tx = db.transaction(() => {
    for (const u of SEED_USERS)
      ins.run(
        u.name,
        u.email,
        u.role,
        JSON.stringify(u.platforms),
        JSON.stringify(u.channels),
        u.active ? 1 : 0,
      )
  })
  tx()
}
const kpiCount = (db.prepare('SELECT COUNT(*) AS n FROM kpi_monthly').get() as { n: number }).n
if (kpiCount === 0) {
  const ins = db.prepare('INSERT INTO kpi_monthly (year, month, brand, target) VALUES (?, ?, ?, ?)')
  const tx = db.transaction(() => {
    for (const brand of SEED_KPI_BRANDS)
      for (let m = 1; m <= 12; m++) ins.run(SEED_KPI_YEAR, m, brand, SEED_KPI_MONTHS[m - 1])
  })
  tx()
}

// ---- COGS ----
export function listCogs(): CogsRow[] {
  return (
    db
      .prepare('SELECT sku, name, brand, price, unit_cost, effective_date FROM cogs ORDER BY sku')
      .all() as Array<Record<string, unknown>>
  ).map((r) => ({
    sku: r.sku as string,
    name: r.name as string,
    brand: r.brand as string,
    price: r.price as number,
    unitCost: r.unit_cost as number,
    effectiveDate: r.effective_date as string,
  }))
}

/** Upsert one SKU's unit cost (and effectiveDate). Creates the row if new. */
export function upsertCogs(input: {
  sku: string
  unitCost: number
  effectiveDate?: string
  name?: string
  brand?: string
  price?: number
}): CogsRow {
  const existing = db.prepare('SELECT * FROM cogs WHERE sku = ?').get(input.sku) as
    | Record<string, unknown>
    | undefined
  const eff = input.effectiveDate ?? (existing?.effective_date as string) ?? DEFAULT_EFFECTIVE
  if (existing) {
    db.prepare('UPDATE cogs SET unit_cost = ?, effective_date = ? WHERE sku = ?').run(
      Math.round(input.unitCost),
      eff,
      input.sku,
    )
  } else {
    db.prepare(
      'INSERT INTO cogs (sku, name, brand, price, unit_cost, effective_date) VALUES (?,?,?,?,?,?)',
    ).run(
      input.sku,
      input.name ?? input.sku,
      input.brand ?? 'nonelab',
      input.price ?? 0,
      Math.round(input.unitCost),
      eff,
    )
  }
  return listCogs().find((c) => c.sku === input.sku)!
}

/** sku -> unit cost, used by the P&L fold. */
export function cogsMap(): Map<string, number> {
  return new Map(listCogs().map((c) => [c.sku, c.unitCost]))
}

// ---- bookings ----
export function listBookings(filter?: {
  platform?: 'tiktok' | 'shopee' | 'all'
  brand?: string
}): BookingRow[] {
  const rows = db
    .prepare('SELECT * FROM bookings ORDER BY date DESC, id DESC')
    .all() as Array<Record<string, unknown>>
  return rows
    .map((r) => ({
      id: r.id as number,
      creator: r.creator as string,
      campaign: r.campaign as string,
      brand: r.brand as string,
      platform: r.platform as 'tiktok' | 'shopee',
      fee: r.fee as number,
      date: r.date as string,
      status: r.status as string,
    }))
    .filter((b) => {
      if (filter?.platform && filter.platform !== 'all' && b.platform !== filter.platform)
        return false
      if (filter?.brand && filter.brand !== 'group' && b.brand !== filter.brand) return false
      return true
    })
}

export function addBooking(b: {
  creator: string
  campaign: string
  brand: string
  platform: 'tiktok' | 'shopee'
  fee: number
  date?: string
  status?: string
}): BookingRow {
  const info = db
    .prepare(
      'INSERT INTO bookings (creator, campaign, brand, platform, fee, date, status) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      b.creator,
      b.campaign || '—',
      b.brand,
      b.platform,
      Math.round(b.fee),
      b.date ?? '2026-07-02',
      b.status ?? 'Đang đàm phán',
    )
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid) as BookingRow
}

export function deleteBooking(id: number): boolean {
  return db.prepare('DELETE FROM bookings WHERE id = ?').run(id).changes > 0
}

// ---- users (platform + channel view permissions) ----
function parseArr<T>(raw: unknown): T[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'))
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

function rowToUser(r: Record<string, unknown>): UserRow {
  // NOTE: password_hash is intentionally NOT copied out — only a boolean is exposed.
  return {
    id: r.id as number,
    name: r.name as string,
    email: r.email as string,
    role: r.role as UserRole,
    platforms: parseArr<UserPlatform>(r.platforms),
    channels: parseArr<UserChannel>(r.channels),
    active: (r.active as number) === 1,
    hasPassword: r.password_hash != null && r.password_hash !== '',
  }
}

// Prototype-grade password hashing: sha256 over a per-app salt + password. This is
// NOT production-safe — real auth should use a slow KDF (bcrypt/argon2/scrypt) with
// a per-user salt. TODO replace before any real login is wired up.
const PASSWORD_SALT = 'nonelab-dashboard-proto-v1'
function hashPassword(plain: string): string {
  return crypto.createHash('sha256').update(PASSWORD_SALT + plain).digest('hex')
}

/** Set/reset a user's login password (stores the hash only). Returns false if no user. */
export function setUserPassword(id: number, plainPassword: string): boolean {
  const hash = hashPassword(plainPassword)
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id).changes > 0
}

export function listUsers(): UserRow[] {
  return (db.prepare('SELECT * FROM users ORDER BY id').all() as Array<Record<string, unknown>>).map(
    rowToUser,
  )
}

export function getUser(id: number): UserRow | undefined {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return r ? rowToUser(r) : undefined
}

/** Insert a new user (id auto-assigned). */
export function addUser(u: {
  name: string
  email: string
  role: UserRole
  platforms?: UserPlatform[]
  channels?: UserChannel[]
  active?: boolean
}): UserRow {
  const info = db
    .prepare('INSERT INTO users (name, email, role, platforms, channels, active) VALUES (?,?,?,?,?,?)')
    .run(
      u.name,
      u.email,
      u.role,
      JSON.stringify(u.platforms ?? []),
      JSON.stringify(u.channels ?? []),
      u.active === false ? 0 : 1,
    )
  return getUser(Number(info.lastInsertRowid))!
}

/** Update an existing user by id (only provided fields change). */
export function upsertUser(
  id: number,
  patch: {
    name?: string
    email?: string
    role?: UserRole
    platforms?: UserPlatform[]
    channels?: UserChannel[]
    active?: boolean
  },
): UserRow | undefined {
  const cur = getUser(id)
  if (!cur) return undefined
  const next = {
    name: patch.name ?? cur.name,
    email: patch.email ?? cur.email,
    role: patch.role ?? cur.role,
    platforms: patch.platforms ?? cur.platforms,
    channels: patch.channels ?? cur.channels,
    active: patch.active ?? cur.active,
  }
  db.prepare(
    'UPDATE users SET name = ?, email = ?, role = ?, platforms = ?, channels = ?, active = ? WHERE id = ?',
  ).run(
    next.name,
    next.email,
    next.role,
    JSON.stringify(next.platforms),
    JSON.stringify(next.channels),
    next.active ? 1 : 0,
    id,
  )
  return getUser(id)
}

export function deleteUser(id: number): boolean {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0
}

// ---- KPI monthly targets, PER BRAND (12 per year; day/week/quarter/year derived) ----

/** One brand's 12 monthly targets (missing months default to the seed). */
function brandMonths(year: number, brand: string): number[] {
  const rows = db
    .prepare('SELECT month, target FROM kpi_monthly WHERE year = ? AND brand = ? ORDER BY month')
    .all(year, brand) as Array<{ month: number; target: number }>
  const months = Array.from({ length: 12 }, () => SEED_KPI_MONTHS[0])
  for (const r of rows) if (r.month >= 1 && r.month <= 12) months[r.month - 1] = r.target
  return months
}

/**
 * getKpiMonthly: a specific brand → that brand's 12 months; 'group' → element-wise
 * SUM across all brands that have any stored targets (falls back to the seed brands).
 */
export function getKpiMonthly(year: number, brand: string): KpiMonthly {
  if (brand !== 'group') return { year, brand, months: brandMonths(year, brand) }
  const brands = (
    db.prepare('SELECT DISTINCT brand FROM kpi_monthly WHERE year = ?').all(year) as Array<{
      brand: string
    }>
  ).map((r) => r.brand)
  const list = brands.length > 0 ? brands : SEED_KPI_BRANDS
  const months = Array.from({ length: 12 }, () => 0)
  for (const b of list) {
    const bm = brandMonths(year, b)
    for (let i = 0; i < 12; i++) months[i] += bm[i]
  }
  return { year, brand: 'group', months }
}

/** Set one month's target for a (year, brand). month is 1..12. 'group' is rejected. */
export function setKpiMonth(year: number, month: number, brand: string, target: number): KpiMonthly {
  db.prepare(
    'INSERT INTO kpi_monthly (year, month, brand, target) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(year, month, brand) DO UPDATE SET target = excluded.target',
  ).run(year, month, brand, Math.round(target))
  return getKpiMonthly(year, brand)
}
