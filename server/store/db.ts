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
  SEED_BRANDS,
  SEED_KPI_BRANDS,
  SEED_KPI_MONTHS,
  SEED_KPI_YEAR,
  SEED_PRODUCTS,
  SEED_SHOPS,
  SEED_USERS,
  type ShopMode,
  type ShopPlatform,
  type UserChannel,
  type UserPlatform,
  type UserRole,
} from './seed'
import { decryptJson, encryptJson } from './crypto'

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

export interface BrandRow {
  id: number
  key: string
  name: string
  active: boolean
}

/** TikTok shop credentials (server-only; never sent to the browser in the clear). */
export interface TikTokShopCreds {
  appKey?: string
  appSecret?: string
  /** Partner "service_id" used to build the seller authorization URL (OAuth start). */
  serviceId?: string
  accessToken?: string
  shopCipher?: string
  baseUrl?: string
  bizAccessToken?: string
  advertiserId?: string
  bizBaseUrl?: string
}

/** Shopee shop credentials (server-only). */
export interface ShopeeShopCreds {
  partnerId?: string
  partnerKey?: string
  accessToken?: string
  shopId?: string
  baseUrl?: string
}

/** OAuth refresh fields shared by both platforms (auto-refresh of access_token). */
export interface OAuthFields {
  /** Long-lived refresh token used to mint a fresh access_token when it expires. */
  refreshToken?: string
  /** Unix SECONDS the current access_token expires at (set after each refresh). */
  tokenExpiresAt?: number
}

export type ShopCreds = TikTokShopCreds & ShopeeShopCreds & OAuthFields

/** Last connection-test outcome, persisted so the shop list shows status + when. */
export interface ShopTestStatus {
  /** ISO timestamp of the last test (undefined = never tested). */
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestMsg?: string
}

/** A shop with DECRYPTED credentials — server-internal only (fetch layer). */
export interface ShopRow extends ShopTestStatus {
  id: number
  brandKey: string
  platform: ShopPlatform
  name: string
  mode: ShopMode
  active: boolean
  credentials: ShopCreds
}

/** A shop as returned to the browser — credentials are MASKED (booleans only). */
export interface ShopMasked extends ShopTestStatus {
  id: number
  brandKey: string
  platform: ShopPlatform
  name: string
  mode: ShopMode
  active: boolean
  /** Which credential fields have a value set (never the values themselves). */
  configured: Record<string, boolean>
  /** True if a refresh token is stored (enables auto-refresh). */
  autoRefresh: boolean
}

/** Credential field names shown/collected per platform (order = UI order). */
export const CRED_FIELDS: Record<ShopPlatform, string[]> = {
  tiktok: [
    'appKey',
    'appSecret',
    'serviceId',
    'accessToken',
    'refreshToken',
    'shopCipher',
    'bizAccessToken',
    'advertiserId',
    'baseUrl',
    'bizBaseUrl',
  ],
  shopee: ['partnerId', 'partnerKey', 'accessToken', 'refreshToken', 'shopId', 'baseUrl'],
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
  CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL, -- slug used as the brand filter value everywhere
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_key TEXT NOT NULL,               -- -> brands.key
    platform TEXT NOT NULL,                -- 'tiktok' | 'shopee'
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'sample',   -- 'sample' | 'live'
    active INTEGER NOT NULL DEFAULT 1,
    credentials TEXT NOT NULL DEFAULT ''   -- AES-256-GCM encrypted JSON blob
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

// Per-shop last connection-test status (nullable; set by POST /api/shops/:id/test).
addColumnIfMissing('shops', 'last_test_at', 'last_test_at TEXT')
addColumnIfMissing('shops', 'last_test_ok', 'last_test_ok INTEGER')
addColumnIfMissing('shops', 'last_test_msg', 'last_test_msg TEXT')

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
const brandCount = (db.prepare('SELECT COUNT(*) AS n FROM brands').get() as { n: number }).n
if (brandCount === 0) {
  const ins = db.prepare('INSERT INTO brands (key, name, active) VALUES (?, ?, 1)')
  const tx = db.transaction(() => {
    for (const b of SEED_BRANDS) ins.run(b.key, b.name)
  })
  tx()
}
const shopCount = (db.prepare('SELECT COUNT(*) AS n FROM shops').get() as { n: number }).n
if (shopCount === 0) {
  const ins = db.prepare(
    'INSERT INTO shops (brand_key, platform, name, mode, active, credentials) VALUES (?,?,?,?,1,?)',
  )
  const tx = db.transaction(() => {
    for (const s of SEED_SHOPS) ins.run(s.brandKey, s.platform, s.name, s.mode, '')
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

/** Verify email+password and return the active user, or null on failure. */
export function checkLogin(email: string, plain: string): UserRow | null {
  const r = db
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1')
    .get(email) as Record<string, unknown> | undefined
  if (!r) return null
  const hash = r.password_hash as string | null
  if (!hash) return null
  if (hash !== hashPassword(plain)) return null
  return rowToUser(r)
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

// ---- brands (multi-brand) ----

function rowToBrand(r: Record<string, unknown>): BrandRow {
  return {
    id: r.id as number,
    key: r.key as string,
    name: r.name as string,
    active: (r.active as number) === 1,
  }
}

export function listBrands(): BrandRow[] {
  return (
    db.prepare('SELECT * FROM brands ORDER BY name').all() as Array<Record<string, unknown>>
  ).map(rowToBrand)
}

export function getBrand(id: number): BrandRow | undefined {
  const r = db.prepare('SELECT * FROM brands WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return r ? rowToBrand(r) : undefined
}

/** Slugify a brand key (lowercase, ascii, dashes) — stable id for the filter value. */
function slugify(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Insert a brand. If key omitted, derive from name. Throws on duplicate key. */
export function addBrand(input: { key?: string; name: string }): BrandRow {
  const key = slugify(input.key || input.name)
  if (!key) throw new Error('brand key/name required')
  const existing = db.prepare('SELECT id FROM brands WHERE key = ?').get(key)
  if (existing) throw new Error(`brand key '${key}' already exists`)
  const info = db
    .prepare('INSERT INTO brands (key, name, active) VALUES (?, ?, 1)')
    .run(key, input.name)
  return getBrand(Number(info.lastInsertRowid))!
}

export function updateBrand(
  id: number,
  patch: { name?: string; active?: boolean },
): BrandRow | undefined {
  const cur = getBrand(id)
  if (!cur) return undefined
  const name = patch.name ?? cur.name
  const active = patch.active ?? cur.active
  db.prepare('UPDATE brands SET name = ?, active = ? WHERE id = ?').run(name, active ? 1 : 0, id)
  return getBrand(id)
}

/** Delete a brand. Blocked (throws) if it still has shops attached. */
export function deleteBrand(id: number): boolean {
  const b = getBrand(id)
  if (!b) return false
  const shopN = (
    db.prepare('SELECT COUNT(*) AS n FROM shops WHERE brand_key = ?').get(b.key) as { n: number }
  ).n
  if (shopN > 0) throw new Error(`brand '${b.key}' still has ${shopN} shop(s) — remove them first`)
  return db.prepare('DELETE FROM brands WHERE id = ?').run(id).changes > 0
}

// ---- shops (per-brand, per-platform; credentials encrypted at rest) ----

function rowToShop(r: Record<string, unknown>): ShopRow {
  return {
    id: r.id as number,
    brandKey: r.brand_key as string,
    platform: r.platform as ShopPlatform,
    name: r.name as string,
    mode: r.mode as ShopMode,
    active: (r.active as number) === 1,
    credentials: decryptJson<ShopCreds>(r.credentials as string),
    lastTestAt: (r.last_test_at as string) || undefined,
    lastTestOk: r.last_test_ok == null ? undefined : (r.last_test_ok as number) === 1,
    lastTestMsg: (r.last_test_msg as string) || undefined,
  }
}

/** Mask a decrypted shop for the browser: never expose secret values. */
export function maskShop(s: ShopRow): ShopMasked {
  const fields = CRED_FIELDS[s.platform] ?? []
  const configured: Record<string, boolean> = {}
  for (const f of fields) {
    const v = (s.credentials as Record<string, unknown>)[f]
    configured[f] = typeof v === 'string' ? v.trim() !== '' : v != null
  }
  return {
    id: s.id,
    brandKey: s.brandKey,
    platform: s.platform,
    name: s.name,
    mode: s.mode,
    active: s.active,
    configured,
    autoRefresh: !!s.credentials.refreshToken,
    lastTestAt: s.lastTestAt,
    lastTestOk: s.lastTestOk,
    lastTestMsg: s.lastTestMsg,
  }
}

/** List shops (decrypted — server-internal). Filter by brand/platform/active. */
export function listShops(filter?: {
  brandKey?: string
  platform?: ShopPlatform
  activeOnly?: boolean
}): ShopRow[] {
  const rows = db
    .prepare('SELECT * FROM shops ORDER BY brand_key, platform, id')
    .all() as Array<Record<string, unknown>>
  return rows
    .map(rowToShop)
    .filter((s) => {
      if (filter?.brandKey && filter.brandKey !== 'group' && s.brandKey !== filter.brandKey)
        return false
      if (filter?.platform && s.platform !== filter.platform) return false
      if (filter?.activeOnly && !s.active) return false
      return true
    })
}

/** Masked list for the API/browser. */
export function listShopsMasked(filter?: {
  brandKey?: string
  platform?: ShopPlatform
}): ShopMasked[] {
  return listShops(filter).map(maskShop)
}

export function getShop(id: number): ShopRow | undefined {
  const r = db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return r ? rowToShop(r) : undefined
}

/** Only keep non-empty credential fields valid for the platform. */
function cleanCreds(platform: ShopPlatform, raw: Record<string, unknown> | undefined): ShopCreds {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const f of CRED_FIELDS[platform] ?? []) {
    const v = raw[f]
    if (typeof v === 'string' && v.trim() !== '') out[f] = v.trim()
  }
  return out as ShopCreds
}

export function addShop(input: {
  brandKey: string
  platform: ShopPlatform
  name: string
  mode?: ShopMode
  active?: boolean
  credentials?: Record<string, unknown>
}): ShopMasked {
  const creds = cleanCreds(input.platform, input.credentials)
  const info = db
    .prepare(
      'INSERT INTO shops (brand_key, platform, name, mode, active, credentials) VALUES (?,?,?,?,?,?)',
    )
    .run(
      input.brandKey,
      input.platform,
      input.name,
      input.mode ?? 'sample',
      input.active === false ? 0 : 1,
      encryptJson(creds),
    )
  return maskShop(getShop(Number(info.lastInsertRowid))!)
}

/**
 * Update a shop. credentials are MERGED: only fields provided (non-empty) overwrite;
 * omitted fields keep their stored value (so the UI never has to re-send secrets).
 */
export function updateShop(
  id: number,
  patch: {
    name?: string
    mode?: ShopMode
    active?: boolean
    credentials?: Record<string, unknown>
  },
): ShopMasked | undefined {
  const cur = getShop(id)
  if (!cur) return undefined
  const name = patch.name ?? cur.name
  const mode = patch.mode ?? cur.mode
  const active = patch.active ?? cur.active
  let credBlob: string
  if (patch.credentials) {
    const incoming = cleanCreds(cur.platform, patch.credentials)
    const merged = { ...cur.credentials, ...incoming }
    credBlob = encryptJson(merged)
  } else {
    credBlob = encryptJson(cur.credentials)
  }
  db.prepare('UPDATE shops SET name = ?, mode = ?, active = ?, credentials = ? WHERE id = ?').run(
    name,
    mode,
    active ? 1 : 0,
    credBlob,
    id,
  )
  return maskShop(getShop(id)!)
}

export function deleteShop(id: number): boolean {
  return db.prepare('DELETE FROM shops WHERE id = ?').run(id).changes > 0
}

/** Record the outcome of a connection test (persisted; shown on the shop list). */
export function recordShopTest(id: number, ok: boolean, message: string, at: string): void {
  db.prepare('UPDATE shops SET last_test_at = ?, last_test_ok = ?, last_test_msg = ? WHERE id = ?').run(
    at,
    ok ? 1 : 0,
    message.slice(0, 500),
    id,
  )
}

/**
 * Persist refreshed OAuth tokens for a shop (from the auto-refresh flow). Merges into
 * the existing encrypted credentials — bypasses cleanCreds so tokenExpiresAt (a number,
 * not a UI field) is retained. Returns the updated (decrypted) shop.
 */
export function setShopTokens(
  id: number,
  tokens: {
    accessToken?: string
    refreshToken?: string
    tokenExpiresAt?: number
    shopCipher?: string
    shopId?: string
  },
): ShopRow | undefined {
  const cur = getShop(id)
  if (!cur) return undefined
  const merged: ShopCreds = { ...cur.credentials }
  if (tokens.accessToken) merged.accessToken = tokens.accessToken
  if (tokens.refreshToken) merged.refreshToken = tokens.refreshToken
  if (tokens.tokenExpiresAt != null) merged.tokenExpiresAt = tokens.tokenExpiresAt
  if (tokens.shopCipher) merged.shopCipher = tokens.shopCipher
  if (tokens.shopId) merged.shopId = tokens.shopId
  db.prepare('UPDATE shops SET credentials = ? WHERE id = ?').run(encryptJson(merged), id)
  return getShop(id)
}

// ---- API-fetched data persistence ----
// Two tables: daily_data (one row per shop/platform/day) and snapshot_data
// (aggregated results per shop/platform/type/period). Both survive BFF restarts,
// allowing historical analysis and offline operation when external APIs are down.

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_data (
    shop_id    INTEGER NOT NULL,
    platform   TEXT NOT NULL,
    date       TEXT NOT NULL,
    data       TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (shop_id, platform, date)
  );
  CREATE TABLE IF NOT EXISTS snapshot_data (
    shop_id    INTEGER NOT NULL,
    platform   TEXT NOT NULL,
    type       TEXT NOT NULL,
    period     TEXT NOT NULL,
    data       TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (shop_id, platform, type, period)
  );
`)

// Recent data (within 3 days, incl. today) refreshes every 2h; older data is
// considered settled and kept permanently (never auto-staled by age).
const RECENT_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const STALE_RECENT_MS = 2 * 60 * 60 * 1000

function isDailyStale(dateStr: string, fetchedAt: string): boolean {
  const recentCutoff = new Date(Date.now() - RECENT_DAYS_MS).toISOString().slice(0, 10)
  if (dateStr < recentCutoff) return false // historical: settled, keep permanently
  return Date.now() - new Date(fetchedAt).getTime() > STALE_RECENT_MS
}

/** Returns the set of dates in [start,end] that are fresh (present & not stale). */
export function getFreshDailyDates(
  shopId: number,
  platform: string,
  start: string,
  end: string,
): Set<string> {
  const rows = db
    .prepare(
      'SELECT date, fetched_at FROM daily_data WHERE shop_id=? AND platform=? AND date>=? AND date<=?',
    )
    .all(shopId, platform, start, end) as Array<{ date: string; fetched_at: string }>
  const fresh = new Set<string>()
  for (const r of rows) {
    if (!isDailyStale(r.date, r.fetched_at)) fresh.add(r.date)
  }
  return fresh
}

/** Load all fresh cached daily rows for [start, end] as a date→row map. */
export function loadDailyRows<T>(
  shopId: number,
  platform: string,
  start: string,
  end: string,
): Map<string, T> {
  const rows = db
    .prepare(
      'SELECT date, data, fetched_at FROM daily_data WHERE shop_id=? AND platform=? AND date>=? AND date<=?',
    )
    .all(shopId, platform, start, end) as Array<{
    date: string
    data: string
    fetched_at: string
  }>
  const result = new Map<string, T>()
  for (const r of rows) {
    if (!isDailyStale(r.date, r.fetched_at)) result.set(r.date, JSON.parse(r.data) as T)
  }
  return result
}

/** Upsert a batch of normalized daily rows (each must have a `date` field). */
export function saveDailyRows(
  shopId: number,
  platform: string,
  rows: Array<{ date: string } & Record<string, unknown>>,
): void {
  if (rows.length === 0) return
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO daily_data (shop_id, platform, date, data, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(shop_id, platform, date)
    DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at
  `)
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run(shopId, platform, row.date, JSON.stringify(row), now)
  })
  tx()
}

/** Load a cached snapshot, or null if missing or older than ttlMs (default 2h). */
export function loadSnapshot<T>(
  shopId: number,
  platform: string,
  type: string,
  period: string,
  ttlMs = STALE_RECENT_MS,
): T[] | null {
  const r = db
    .prepare(
      'SELECT data, fetched_at FROM snapshot_data WHERE shop_id=? AND platform=? AND type=? AND period=?',
    )
    .get(shopId, platform, type, period) as { data: string; fetched_at: string } | undefined
  if (!r) return null
  if (Date.now() - new Date(r.fetched_at).getTime() > ttlMs) return null
  return JSON.parse(r.data) as T[]
}

/** Upsert a snapshot (overwrites any existing entry for the same key). */
export function saveSnapshot(
  shopId: number,
  platform: string,
  type: string,
  period: string,
  data: unknown[],
): void {
  db
    .prepare(`
      INSERT INTO snapshot_data (shop_id, platform, type, period, data, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, platform, type, period)
      DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at
    `)
    .run(shopId, platform, type, period, JSON.stringify(data), new Date().toISOString())
}

/** Row counts for each cache table (for the management endpoint). */
export function getApiCacheStats(): {
  daily: number
  snapshots: number
  dailyByPlatform: Record<string, number>
} {
  const daily = (db.prepare('SELECT COUNT(*) AS n FROM daily_data').get() as { n: number }).n
  const snapshots = (
    db.prepare('SELECT COUNT(*) AS n FROM snapshot_data').get() as { n: number }
  ).n
  const byPlat = db
    .prepare('SELECT platform, COUNT(*) AS n FROM daily_data GROUP BY platform')
    .all() as Array<{ platform: string; n: number }>
  const dailyByPlatform: Record<string, number> = {}
  for (const r of byPlat) dailyByPlatform[r.platform] = r.n
  return { daily, snapshots, dailyByPlatform }
}

/** Delete all cached API data, optionally scoped to a single shop. */
export function flushApiCache(shopId?: number): void {
  if (shopId !== undefined) {
    db.prepare('DELETE FROM daily_data WHERE shop_id=?').run(shopId)
    db.prepare('DELETE FROM snapshot_data WHERE shop_id=?').run(shopId)
  } else {
    db.prepare('DELETE FROM daily_data').run()
    db.prepare('DELETE FROM snapshot_data').run()
  }
}

// ---- Raw orders (per-order storage, queryable by date range) ----
// Stores every individual order as JSON. Shopee orders embed `_income: OrderIncome`
// so fee breakdown is co-located. Indexed by create_date for fast range queries.

db.exec(`
  CREATE TABLE IF NOT EXISTS raw_orders (
    shop_id     INTEGER NOT NULL,
    platform    TEXT NOT NULL,
    order_sn    TEXT NOT NULL,
    create_date TEXT NOT NULL,
    data        TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (shop_id, platform, order_sn)
  );
  CREATE INDEX IF NOT EXISTS idx_raw_orders_date
    ON raw_orders (shop_id, platform, create_date);
`)

/**
 * Upsert a batch of raw orders. Each entry must supply `order_sn` (unique key),
 * `create_time_secs` (unix epoch, used to derive create_date in UTC+7), and
 * `data` (the full order object — for Shopee include `_income` embedded).
 */
export function saveRawOrders(
  shopId: number,
  platform: string,
  orders: Array<{ order_sn: string; create_time_secs: number; data: unknown }>,
): void {
  if (orders.length === 0) return
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO raw_orders (shop_id, platform, order_sn, create_date, data, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_id, platform, order_sn)
    DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at
  `)
  const tx = db.transaction(() => {
    for (const o of orders) {
      // Convert unix seconds to YYYY-MM-DD in Asia/Ho_Chi_Minh (UTC+7).
      const dateTz = new Date((o.create_time_secs + 7 * 3600) * 1000).toISOString().slice(0, 10)
      stmt.run(shopId, platform, o.order_sn, dateTz, JSON.stringify(o.data), now)
    }
  })
  tx()
}

/** Load all orders for a date range (create_date in [start, end]). */
export function loadRawOrders<T>(
  shopId: number,
  platform: string,
  start: string,
  end: string,
): T[] {
  return (
    db
      .prepare(
        'SELECT data FROM raw_orders WHERE shop_id=? AND platform=? AND create_date>=? AND create_date<=?',
      )
      .all(shopId, platform, start, end) as Array<{ data: string }>
  ).map((r) => JSON.parse(r.data) as T)
}

/**
 * order_sn -> _income for Shopee raw orders in [start,end] that ALREADY have escrow
 * embedded. Used to (a) skip re-fetching escrow per order (incremental), and (b)
 * preserve income when the daily poll re-saves orders without it.
 */
export function loadRawOrderIncomeMap(
  shopId: number,
  start: string,
  end: string,
): Map<string, unknown> {
  const rows = db
    .prepare(
      "SELECT order_sn, json_extract(data,'$._income') AS inc FROM raw_orders " +
        "WHERE shop_id=? AND platform='shopee' AND create_date>=? AND create_date<=? " +
        "AND json_extract(data,'$._income') IS NOT NULL",
    )
    .all(shopId, start, end) as Array<{ order_sn: string; inc: string }>
  const m = new Map<string, unknown>()
  for (const r of rows) {
    try {
      m.set(r.order_sn, JSON.parse(r.inc))
    } catch {
      /* skip malformed row */
    }
  }
  return m
}

// Pre-normalized recon orders written by the poller so route handlers serve
// a single JSON blob instead of normalizing 20k+ rows on every request.
db.exec(`
  CREATE TABLE IF NOT EXISTS recon_cache (
    shop_id    INTEGER NOT NULL,
    platform   TEXT NOT NULL,
    data       TEXT NOT NULL,
    saved_at   TEXT NOT NULL,
    PRIMARY KEY (shop_id, platform)
  )
`)

/** Replace the pre-normalized recon list for one shop. Called by the poller. */
export function saveReconCache(shopId: number, platform: string, rows: unknown[]): void {
  db.prepare(`
    INSERT INTO recon_cache (shop_id, platform, data, saved_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(shop_id, platform) DO UPDATE SET data=excluded.data, saved_at=excluded.saved_at
  `).run(shopId, platform, JSON.stringify(rows), new Date().toISOString())
}

/**
 * One-time startup migration: copy existing recon snapshots into recon_cache so the
 * cache is warm immediately after restart (no 20k-order normalization on first request).
 * Skips shops that already have a recon_cache entry (idempotent).
 */
export function warmReconCacheFromSnapshots(): void {
  const existing = (db.prepare('SELECT shop_id, platform FROM recon_cache').all() as Array<{ shop_id: number; platform: string }>)
  const covered = new Set(existing.map((r) => `${r.shop_id}:${r.platform}`))

  const snaps = db.prepare(`
    SELECT shop_id, platform, data FROM snapshot_data
    WHERE type='recon'
    ORDER BY fetched_at DESC
  `).all() as Array<{ shop_id: number; platform: string; data: string }>

  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO recon_cache (shop_id, platform, data, saved_at) VALUES (?, ?, ?, ?)
  `)
  const tx = db.transaction(() => {
    const seen = new Set<string>()
    for (const snap of snaps) {
      const key = `${snap.shop_id}:${snap.platform}`
      if (covered.has(key) || seen.has(key)) continue
      seen.add(key)
      stmt.run(snap.shop_id, snap.platform, snap.data, now)
    }
  })
  tx()
}

/** Load pre-normalized recon for one shop, or null if not yet populated. */
export function loadReconCache<T>(shopId: number, platform: string): T[] | null {
  const row = db
    .prepare('SELECT data FROM recon_cache WHERE shop_id=? AND platform=?')
    .get(shopId, platform) as { data: string } | undefined
  return row ? (JSON.parse(row.data) as T[]) : null
}

/** Count raw orders by platform (for cache stats). */
export function getRawOrdersCount(): Record<string, number> {
  const rows = db
    .prepare('SELECT platform, COUNT(*) AS n FROM raw_orders GROUP BY platform')
    .all() as Array<{ platform: string; n: number }>
  const result: Record<string, number> = {}
  for (const r of rows) result[r.platform] = r.n
  return result
}
