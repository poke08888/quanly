// Backend BFF: signs + calls TikTok (Shop Partner API + API for Business) and
// Shopee (Open API v2) server-side (live) OR loads official-shaped fixtures
// (sample), runs BOTH through the same per-platform normalizers, and returns
// already-normalized DailyRow[]/Campaign[] JSON. The browser never sees any
// app_secret / partner_key. TikTok and Shopee have independent sample|live modes.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import 'dotenv/config'

import {
  normalizeCreators,
  normalizeDailySeries,
  normalizeReconOrders as normalizeTiktokRecon,
  normalizeTopProducts as normalizeTiktokTopProducts,
  offsetOf,
  type Catalog,
} from './tiktok/normalize'
import { fetchAnalytics, fetchFinanceStatements, type TikTokCreds } from './tiktok/client'
import { fetchAffiliateOrders } from './tiktok/affiliateClient'
import { fetchOrderSearch, fetchShopProducts } from './tiktok/catalogClient'
import type {
  AffiliateOrder,
  AffiliateOrdersEnvelope,
  AnalyticsEnvelope,
  Creator,
  DailyRow,
  FinanceEnvelope,
  OrderSearchEnvelope,
  ProductPerf as TiktokProductPerf,
  ReconOrder as TiktokReconOrder,
  ShopProduct,
  ShopProductsEnvelope,
} from './tiktok/types'

import {
  listCogs,
  upsertCogs,
  listBookings,
  addBooking as storeAddBooking,
  deleteBooking as storeDeleteBooking,
  listUsers,
  addUser as storeAddUser,
  upsertUser as storeUpsertUser,
  deleteUser as storeDeleteUser,
  setUserPassword as storeSetUserPassword,
  getKpiMonthly as storeGetKpiMonthly,
  setKpiMonth as storeSetKpiMonth,
} from './store/db'

import { normalizeCampaigns, normalizeDailySpend } from './tiktokbiz/normalize'
import {
  fetchCampaignMeta,
  fetchCampaignReport,
  fetchDailyReport,
  type TikTokBizCreds,
} from './tiktokbiz/client'
import type {
  BizCampaignEnvelope,
  BizCampaignRow,
  BizReportEnvelope,
  Campaign as BizCampaign,
} from './tiktokbiz/types'

import {
  normalizeDailySeries as normalizeShopeeDailySeries,
  normalizeShopeeCampaigns,
  normalizeShopeeDailySpend,
} from './shopee/normalize'
import {
  normalizeReconOrders as normalizeShopeeRecon,
  normalizeTopProducts as normalizeShopeeTopProducts,
} from './shopee/normalize'
import { fetchOrdersAndEscrow, type ShopeeCreds } from './shopee/client'
import { fetchAdsCampaigns, fetchAdsDaily } from './shopee/adsClient'
import type {
  AdsCampaignRow,
  AdsDailyRow,
  Campaign as ShopeeCampaign,
  Catalog as ShopeeCatalog,
  DailyRow as ShopeeDailyRow,
  OrderDetail,
  OrderDetailResponse,
  OrderIncome,
  ProductPerf as ShopeeProductPerf,
  ReconOrder as ShopeeReconOrder,
} from './shopee/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, 'fixtures')

const MODE = (process.env.TIKTOK_MODE ?? 'sample').toLowerCase() as 'sample' | 'live'
const SHOPEE_MODE = (process.env.SHOPEE_MODE ?? 'sample').toLowerCase() as 'sample' | 'live'
const PORT = Number(process.env.PORT ?? 8790)
const BASE_URL = process.env.TIKTOK_BASE_URL ?? 'https://open-api.tiktokglobalshop.com'
const BIZ_BASE_URL = process.env.TIKTOK_BIZ_BASE_URL ?? 'https://business-api.tiktok.com'
const SHOPEE_BASE_URL = process.env.SHOPEE_BASE_URL ?? 'https://partner.shopeemobile.com'

function loadFixture<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf-8')) as T
}

/** Build the sku -> {brand,name,price,unitCost} catalog from the cost store. */
function buildCatalog(): Catalog {
  const cat: Catalog = new Map()
  for (const c of listCogs())
    cat.set(c.sku, { brand: c.brand, name: c.name, price: c.price, unitCost: c.unitCost })
  return cat
}

/** Period net ratio (netRevenue / gmv) used for product margin. */
function netRatioOf(rows: DailyRow[] | ShopeeDailyRow[]): number {
  let gmv = 0
  let net = 0
  for (const r of rows) {
    gmv += r.gmv
    net += r.netRevenue
  }
  return gmv ? net / gmv : 0
}

function creds(): TikTokCreds {
  const missing = ['TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_SHOP_CIPHER'].filter(
    (k) => !process.env[k],
  )
  if (missing.length) throw new Error(`live mode requires env: ${missing.join(', ')}`)
  return {
    appKey: process.env.TIKTOK_APP_KEY!,
    appSecret: process.env.TIKTOK_APP_SECRET!,
    accessToken: process.env.TIKTOK_ACCESS_TOKEN!,
    shopCipher: process.env.TIKTOK_SHOP_CIPHER!,
    baseUrl: BASE_URL,
  }
}

/** Credentials for the TikTok API for Business (Ads) — no HMAC, header token. */
function bizCreds(): TikTokBizCreds {
  const missing = ['TIKTOK_BIZ_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'].filter((k) => !process.env[k])
  if (missing.length) throw new Error(`live mode requires env: ${missing.join(', ')}`)
  return {
    accessToken: process.env.TIKTOK_BIZ_ACCESS_TOKEN!,
    advertiserId: process.env.TIKTOK_ADVERTISER_ID!,
    baseUrl: BIZ_BASE_URL,
  }
}

/** Per-day ad spend (sample fixtures or live report), keyed by YYYY-MM-DD. */
async function adSpendByDay(start: string, end: string): Promise<Map<string, number>> {
  let rows: BizReportEnvelope['data']['list']
  if (MODE === 'live') {
    rows = await fetchDailyReport(bizCreds(), start, end)
  } else {
    rows = loadFixture<BizReportEnvelope>('biz_report_daily.json').data.list
  }
  const spend = normalizeDailySpend(rows)
  return new Map(spend.map((s) => [s.date, s.adSpend]))
}

/** TikTok Ads campaigns (sample fixtures or live report + names), normalized. */
async function campaigns(start: string, end: string, brand: string): Promise<BizCampaign[]> {
  let reportRows: BizReportEnvelope['data']['list']
  let metaRows: BizCampaignRow[]
  if (MODE === 'live') {
    ;[reportRows, metaRows] = await Promise.all([
      fetchCampaignReport(bizCreds(), start, end),
      fetchCampaignMeta(bizCreds()),
    ])
  } else {
    reportRows = loadFixture<BizReportEnvelope>('biz_report_campaign.json').data.list
    metaRows = loadFixture<BizCampaignEnvelope>('biz_campaign_get.json').data.list
  }
  const meta = new Map(metaRows.map((m) => [m.campaign_id, m]))
  return normalizeCampaigns(reportRows, meta, brand)
}

/** Fetch raw envelopes (sample fixtures or live API), then normalize identically. */
async function dailySeries(start: string, end: string): Promise<DailyRow[]> {
  let analytics: AnalyticsEnvelope
  let finance: FinanceEnvelope
  if (MODE === 'live') {
    // end is inclusive from the client's perspective; TikTok windows are often
    // [ge, lt), so pass end+1 day as the exclusive bound.
    const endExclusive = addDays(end, 1)
    ;[analytics, finance] = await Promise.all([
      fetchAnalytics(creds(), start, endExclusive),
      fetchFinanceStatements(creds(), start, endExclusive),
    ])
  } else {
    analytics = loadFixture<AnalyticsEnvelope>('analytics_shop_performance.json')
    finance = loadFixture<FinanceEnvelope>('finance_statements.json')
  }
  // Fetch per-day ad spend and inject it as DailyRow.ads (profit recomputed in
  // the normalizer so the P&L identity holds). Days with no spend -> 0.
  const adsByDay = await adSpendByDay(start, MODE === 'live' ? addDays(end, 1) : end)
  // "today" anchors the off (days-ago) field; use the end of the requested window.
  const today = new Date(end + 'T00:00:00Z')
  const rows = normalizeDailySeries(analytics, finance, today, adsByDay)
  // Clamp to the requested [start, end] window.
  return rows.filter((r) => r.date >= start && r.date <= end)
}

/** Credentials for Shopee Open API v2 (HMAC shop-level signing). */
function shopeeCreds(): ShopeeCreds {
  const missing = [
    'SHOPEE_PARTNER_ID',
    'SHOPEE_PARTNER_KEY',
    'SHOPEE_ACCESS_TOKEN',
    'SHOPEE_SHOP_ID',
  ].filter((k) => !process.env[k])
  if (missing.length) throw new Error(`live mode requires env: ${missing.join(', ')}`)
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID!,
    partnerKey: process.env.SHOPEE_PARTNER_KEY!,
    accessToken: process.env.SHOPEE_ACCESS_TOKEN!,
    shopId: process.env.SHOPEE_SHOP_ID!,
    baseUrl: SHOPEE_BASE_URL,
  }
}

/** Unix SECONDS for the start of a YYYY-MM-DD local (Asia/Ho_Chi_Minh) day. */
function localDayStartSec(date: string): number {
  return Date.parse(date + 'T00:00:00Z') / 1000 - 7 * 3600
}

/** Shopee per-day CPC ad spend (sample fixtures or live), keyed by YYYY-MM-DD. */
async function shopeeAdSpendByDay(start: string, end: string): Promise<Map<string, number>> {
  let rows: AdsDailyRow[]
  if (SHOPEE_MODE === 'live') {
    rows = await fetchAdsDaily(shopeeCreds(), start, end)
  } else {
    rows = loadFixture<{ response: { daily_performance_list: AdsDailyRow[] } }>(
      'shopee_ads_daily.json',
    ).response.daily_performance_list
  }
  const spend = normalizeShopeeDailySpend(rows)
  return new Map(spend.map((s) => [s.date, s.adSpend]))
}

/** Shopee CPC ad campaigns (sample fixtures or live), normalized to Campaign[]. */
async function shopeeCampaigns(start: string, end: string, brand: string): Promise<ShopeeCampaign[]> {
  let rows: AdsCampaignRow[]
  if (SHOPEE_MODE === 'live') {
    // TODO enumerate campaign ids (get_product_campaign_setting_info / internal list).
    rows = await fetchAdsCampaigns(shopeeCreds(), start, end, [])
  } else {
    rows = loadFixture<{ response: { campaign_list: AdsCampaignRow[] } }>(
      'shopee_ads_campaign.json',
    ).response.campaign_list
  }
  return normalizeShopeeCampaigns(rows, brand)
}

/** Shopee daily series (sample fixtures or signed live calls), same normalizer. */
async function shopeeDailySeries(start: string, end: string): Promise<ShopeeDailyRow[]> {
  let orders: OrderDetail[]
  let escrow: Map<string, OrderIncome>
  if (SHOPEE_MODE === 'live') {
    // Window [start 00:00, end+1 00:00) in local seconds.
    const timeFrom = localDayStartSec(start)
    const timeTo = localDayStartSec(addDays(end, 1))
    const pulled = await fetchOrdersAndEscrow(shopeeCreds(), timeFrom, timeTo)
    orders = pulled.orders
    escrow = pulled.escrow
  } else {
    orders = loadFixture<OrderDetailResponse>('shopee_order_detail.json').response.order_list
    const rawEscrow = loadFixture<{ orders: { order_sn: string; order_income: OrderIncome }[] }>(
      'shopee_escrow.json',
    )
    escrow = new Map(rawEscrow.orders.map((e) => [e.order_sn, e.order_income]))
  }
  // Inject per-day CPC ad spend as DailyRow.ads (profit recomputed -> residual 0).
  const adsByDay = await shopeeAdSpendByDay(start, end)
  const today = new Date(end + 'T00:00:00Z')
  const rows = normalizeShopeeDailySeries(orders, escrow, today, adsByDay)
  // Clamp to the requested [start, end] window.
  return rows.filter((r) => r.date >= start && r.date <= end)
}

/** TikTok affiliate creators (sample fixtures or live), normalized to Creator[]. */
async function tiktokCreators(start: string, end: string, brand: string): Promise<Creator[]> {
  let orders: AffiliateOrder[]
  if (MODE === 'live') {
    orders = await fetchAffiliateOrders(creds(), start, addDays(end, 1))
  } else {
    orders = loadFixture<AffiliateOrdersEnvelope>('affiliate_orders.json').data.orders
  }
  return normalizeCreators(orders, brand)
}

/** TikTok top products (sample fixtures or live), margin via store cogs + net ratio. */
async function tiktokTopProducts(
  start: string,
  end: string,
  brand: string,
): Promise<TiktokProductPerf[]> {
  let products: ShopProduct[]
  if (MODE === 'live') {
    products = await fetchShopProducts(creds(), start, addDays(end, 1))
  } else {
    products = loadFixture<ShopProductsEnvelope>('tiktok_shop_products.json').data.products
  }
  const netRatio = netRatioOf(await dailySeries(start, end))
  const rows = normalizeTiktokTopProducts(products, buildCatalog(), netRatio)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** TikTok recon orders (sample fixtures or live), fees from finance normalization. */
async function tiktokReconOrders(brand: string): Promise<TiktokReconOrder[]> {
  let search: OrderSearchEnvelope
  let finance: FinanceEnvelope
  let analytics: AnalyticsEnvelope
  if (MODE === 'live') {
    ;[search, finance, analytics] = await Promise.all([
      fetchOrderSearch(creds(), '2026-06-19', '2026-07-03'), // TODO window from caller
      fetchFinanceStatements(creds(), '2026-06-19', '2026-07-03'),
      fetchAnalytics(creds(), '2026-06-19', '2026-07-03'),
    ])
  } else {
    search = loadFixture<OrderSearchEnvelope>('tiktok_order_search.json')
    finance = loadFixture<FinanceEnvelope>('finance_statements.json')
    analytics = loadFixture<AnalyticsEnvelope>('analytics_shop_performance.json')
  }
  const rows = normalizeTiktokRecon(search, finance, buildCatalog(), analytics)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** Shopee order details + escrow (sample fixtures or live). */
async function shopeeOrdersAndEscrow(
  start: string,
  end: string,
): Promise<{ orders: OrderDetail[]; escrow: Map<string, OrderIncome> }> {
  if (SHOPEE_MODE === 'live') {
    const timeFrom = localDayStartSec(start)
    const timeTo = localDayStartSec(addDays(end, 1))
    return fetchOrdersAndEscrow(shopeeCreds(), timeFrom, timeTo)
  }
  const orders = loadFixture<OrderDetailResponse>('shopee_order_detail.json').response.order_list
  const rawEscrow = loadFixture<{ orders: { order_sn: string; order_income: OrderIncome }[] }>(
    'shopee_escrow.json',
  )
  return { orders, escrow: new Map(rawEscrow.orders.map((e) => [e.order_sn, e.order_income])) }
}

/** Shopee top products (sample fixtures or live), margin via store cogs + net ratio. */
async function shopeeTopProducts(
  start: string,
  end: string,
  brand: string,
): Promise<ShopeeProductPerf[]> {
  const { orders } = await shopeeOrdersAndEscrow(start, end)
  const netRatio = netRatioOf(await shopeeDailySeries(start, end))
  const rows = normalizeShopeeTopProducts(orders, buildCatalog() as ShopeeCatalog, netRatio)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** Shopee recon orders (sample fixtures or live), fees from escrow normalization. */
async function shopeeReconOrders(brand: string): Promise<ShopeeReconOrder[]> {
  const { orders, escrow } = await shopeeOrdersAndEscrow('2026-06-19', '2026-07-02')
  // Recon lists individual orders; cap for a manageable table (most recent first).
  const rows = normalizeShopeeRecon(orders, escrow, buildCatalog() as ShopeeCatalog)
  const scoped = brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
  return scoped.slice(0, 60)
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: MODE, shopeeMode: SHOPEE_MODE, port: PORT })
})

app.get('/api/tiktok/daily-series', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  // brand is accepted for API parity; TikTok data is single-shop, so brand
  // scaling is not applied here (the mock scales by brand — TODO if per-brand
  // shop separation is needed, filter by shop_cipher per brand).
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    const rows = await dailySeries(start, end)
    res.json(rows)
  } catch (err) {
    console.error(`[daily-series] brand=${brand}`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/tiktok/campaigns', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    const list = await campaigns(start, MODE === 'live' ? addDays(end, 1) : end, brand)
    res.json(list)
  } catch (err) {
    console.error(`[campaigns] brand=${brand}`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/shopee/daily-series', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  // brand accepted for parity; Shopee data is single-shop (see TODO in normalizer).
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    const rows = await shopeeDailySeries(start, end)
    res.json(rows)
  } catch (err) {
    console.error(`[shopee daily-series] brand=${brand}`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/shopee/campaigns', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    res.json(await shopeeCampaigns(start, end, brand))
  } catch (err) {
    console.error(`[shopee campaigns] brand=${brand}`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/tiktok/creators', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    res.json(await tiktokCreators(start, end, brand))
  } catch (err) {
    console.error(`[tiktok creators] brand=${brand}`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

// ---- Part 2: top products + recon orders (both platforms) ----

app.get('/api/tiktok/top-products', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    res.json(await tiktokTopProducts(start, end, brand))
  } catch (err) {
    console.error(`[tiktok top-products]`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/tiktok/recon-orders', async (req, res) => {
  const brand = String(req.query.brand ?? 'group')
  try {
    res.json(await tiktokReconOrders(brand))
  } catch (err) {
    console.error(`[tiktok recon-orders]`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/shopee/top-products', async (req, res) => {
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  const brand = String(req.query.brand ?? 'group')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    return
  }
  try {
    res.json(await shopeeTopProducts(start, end, brand))
  } catch (err) {
    console.error(`[shopee top-products]`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/shopee/recon-orders', async (req, res) => {
  const brand = String(req.query.brand ?? 'group')
  try {
    res.json(await shopeeReconOrders(brand))
  } catch (err) {
    console.error(`[shopee recon-orders]`, err)
    res.status(502).json({ error: (err as Error).message })
  }
})

// ---- Part 1: cost store CRUD (internal COGS + KOC bookings) ----

app.get('/api/costs/cogs', (_req, res) => {
  res.json(listCogs())
})

app.put('/api/costs/cogs', (req, res) => {
  const { sku, unitCost, effectiveDate, name, brand, price } = req.body ?? {}
  if (typeof sku !== 'string' || !sku || typeof unitCost !== 'number') {
    res.status(400).json({ error: 'sku (string) and unitCost (number) required' })
    return
  }
  res.json(upsertCogs({ sku, unitCost, effectiveDate, name, brand, price }))
})

app.get('/api/costs/bookings', (req, res) => {
  const platform = req.query.platform as 'tiktok' | 'shopee' | 'all' | undefined
  const brand = req.query.brand as string | undefined
  res.json(listBookings({ platform, brand }))
})

app.post('/api/costs/bookings', (req, res) => {
  const b = req.body ?? {}
  if (!b.creator || (b.platform !== 'tiktok' && b.platform !== 'shopee') || typeof b.fee !== 'number') {
    res.status(400).json({ error: 'creator, platform (tiktok|shopee), fee (number) required' })
    return
  }
  res.json(
    storeAddBooking({
      creator: b.creator,
      campaign: b.campaign ?? '',
      brand: b.brand ?? 'nonelab',
      platform: b.platform,
      fee: b.fee,
      date: b.date,
      status: b.status,
    }),
  )
})

app.delete('/api/costs/bookings/:id', (req, res) => {
  const ok = storeDeleteBooking(Number(req.params.id))
  res.status(ok ? 200 : 404).json({ ok })
})

// ---- user management (CEO-only in the UI): platform + channel view permissions ----

app.get('/api/users', (_req, res) => {
  res.json(listUsers())
})

app.post('/api/users', (req, res) => {
  const u = req.body ?? {}
  if (!u.name || !u.email || (u.role !== 'ceo' && u.role !== 'bm' && u.role !== 'ops')) {
    res.status(400).json({ error: 'name, email, role (ceo|bm|ops) required' })
    return
  }
  res.json(
    storeAddUser({
      name: u.name,
      email: u.email,
      role: u.role,
      platforms: Array.isArray(u.platforms) ? u.platforms : [],
      channels: Array.isArray(u.channels) ? u.channels : [],
      active: u.active,
    }),
  )
})

app.put('/api/users/:id', (req, res) => {
  const u = req.body ?? {}
  const updated = storeUpsertUser(Number(req.params.id), {
    name: u.name,
    email: u.email,
    role: u.role,
    platforms: Array.isArray(u.platforms) ? u.platforms : undefined,
    channels: Array.isArray(u.channels) ? u.channels : undefined,
    active: typeof u.active === 'boolean' ? u.active : undefined,
  })
  if (!updated) {
    res.status(404).json({ error: 'user not found' })
    return
  }
  res.json(updated)
})

app.delete('/api/users/:id', (req, res) => {
  const ok = storeDeleteUser(Number(req.params.id))
  res.status(ok ? 200 : 404).json({ ok })
})

app.put('/api/users/:id/password', (req, res) => {
  const password = (req.body ?? {}).password
  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'password must be a string of at least 6 characters' })
    return
  }
  const ok = storeSetUserPassword(Number(req.params.id), password)
  if (!ok) {
    res.status(404).json({ error: 'user not found' })
    return
  }
  // Never return the hash — only confirm.
  res.json({ ok: true, hasPassword: true })
})

// ---- revenue KPI targets (BM-set): 12 monthly targets per year, PER BRAND ----
// day/week/quarter/year are DERIVED on the client. brand='group' = sum of brands.
app.get('/api/kpi-monthly', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear()
  const brand = String(req.query.brand ?? 'group')
  res.json(storeGetKpiMonthly(year, brand))
})

app.put('/api/kpi-monthly', (req, res) => {
  const b = req.body ?? {}
  const year = Number(b.year)
  const month = Number(b.month)
  const brand = String(b.brand ?? '')
  const target = Number(b.target)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: 'year (int) and month (1..12) required' })
    return
  }
  if (!brand || brand === 'group') {
    res.status(400).json({ error: 'KPI toàn group là tổng các brand — chọn brand cụ thể để đặt' })
    return
  }
  if (!Number.isFinite(target) || target < 0) {
    res.status(400).json({ error: 'target must be a non-negative number' })
    return
  }
  res.json(storeSetKpiMonth(year, month, brand, target))
})

app.listen(PORT, () => {
  console.log(
    `BFF listening on :${PORT} (tiktok=${MODE}, shopee=${SHOPEE_MODE}, ` +
      `shop=${BASE_URL}, biz=${BIZ_BASE_URL}, shopeeApi=${SHOPEE_BASE_URL})`,
  )
})

// exported for a quick sanity import / testing without booting the server.
export {
  dailySeries,
  campaigns,
  shopeeDailySeries,
  shopeeCampaigns,
  tiktokCreators,
  offsetOf,
}
