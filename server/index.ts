// Backend BFF: signs + calls TikTok (Shop Partner API + API for Business) and
// Shopee (Open API v2) server-side (live) OR loads official-shaped fixtures
// (sample), runs BOTH through the same per-platform normalizers, and returns
// already-normalized DailyRow[]/Campaign[] JSON. The browser never sees any
// app_secret / partner_key. TikTok and Shopee have independent sample|live modes.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
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
import {
  fetchAnalytics,
  fetchFinanceStatements,
  fetchAuthorizedShops,
  type TikTokCreds,
} from './tiktok/client'
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
  listBrands as storeListBrands,
  addBrand as storeAddBrand,
  updateBrand as storeUpdateBrand,
  deleteBrand as storeDeleteBrand,
  listShopsMasked as storeListShopsMasked,
  getShop as storeGetShop,
  addShop as storeAddShop,
  updateShop as storeUpdateShop,
  deleteShop as storeDeleteShop,
  recordShopTest as storeRecordShopTest,
  setShopTokens as storeSetShopTokens,
  type ShopRow,
} from './store/db'
import {
  resolveShops,
  mergeCampaigns,
  mergeCreators,
  mergeDailyRows,
  mergeRecon,
  mergeTopProducts,
} from './shops'
import { freshTokens, withFreshToken, exchangeTikTokCode } from './oauth'

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
import { fetchOrdersAndEscrow, pingOrders, type ShopeeCreds } from './shopee/client'
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

/** Build TikTok Shop Partner creds from a shop's stored credentials (live only). */
function credsFromShop(shop: ShopRow): TikTokCreds {
  const c = shop.credentials
  const missing = (['appKey', 'appSecret', 'accessToken', 'shopCipher'] as const).filter(
    (k) => !c[k],
  )
  if (missing.length)
    throw new Error(`shop "${shop.name}" (live) thiếu credential: ${missing.join(', ')}`)
  return {
    appKey: c.appKey!,
    appSecret: c.appSecret!,
    accessToken: c.accessToken!,
    shopCipher: c.shopCipher!,
    baseUrl: c.baseUrl || BASE_URL,
  }
}

/** Resolve a brand's active shops for a platform AND auto-refresh expiring tokens. */
async function freshShops(platform: 'tiktok' | 'shopee', brand: string): Promise<ShopRow[]> {
  return freshTokens(resolveShops(platform, brand))
}

/**
 * Fetch per shop, tolerating per-shop failures: a shop that throws (bad/missing
 * credentials, dead token, API error) contributes an EMPTY result and is logged,
 * instead of rejecting the whole batch. This keeps one misconfigured live shop from
 * breaking the entire brand/dashboard — the working shops still render.
 */
async function fetchPerShop<T>(
  shops: ShopRow[],
  fn: (s: ShopRow) => Promise<T[]>,
): Promise<T[][]> {
  return Promise.all(
    shops.map((s) =>
      fn(s).catch((err) => {
        console.warn(
          `[shop ${s.id} "${s.name}" ${s.platform}] bỏ qua do lỗi: ${(err as Error).message}`,
        )
        return [] as T[]
      }),
    ),
  )
}

/** Build TikTok API for Business (Ads) creds from a shop — no HMAC, header token. */
function bizCredsFromShop(shop: ShopRow): TikTokBizCreds {
  const c = shop.credentials
  const missing = (['bizAccessToken', 'advertiserId'] as const).filter((k) => !c[k])
  if (missing.length)
    throw new Error(`shop "${shop.name}" (live) thiếu credential Ads: ${missing.join(', ')}`)
  return {
    accessToken: c.bizAccessToken!,
    advertiserId: c.advertiserId!,
    baseUrl: c.bizBaseUrl || BIZ_BASE_URL,
  }
}

/** Per-day ad spend for ONE shop (sample fixtures or live report), by YYYY-MM-DD. */
async function adSpendByDayForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  let rows: BizReportEnvelope['data']['list']
  if (shop.mode === 'live') {
    // Ads (TikTok API for Business) is OPTIONAL and a SEPARATE app: if this shop has
    // no Ads creds, or the Ads call fails, treat ad spend as 0 rather than failing the
    // whole daily-series (revenue must still show even without an Ads integration).
    const c = shop.credentials
    if (!c.bizAccessToken || !c.advertiserId) return new Map()
    try {
      rows = await fetchDailyReport(bizCredsFromShop(shop), start, end)
    } catch (err) {
      console.warn(`[shop ${shop.id} "${shop.name}" ads] bỏ qua chi phí ads: ${(err as Error).message}`)
      return new Map()
    }
  } else {
    rows = loadFixture<BizReportEnvelope>('biz_report_daily.json').data.list
  }
  const spend = normalizeDailySpend(rows)
  return new Map(spend.map((s) => [s.date, s.adSpend]))
}

/** TikTok Ads campaigns for ONE shop (sample or live report + names), normalized. */
async function campaignsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  brand: string,
): Promise<BizCampaign[]> {
  let reportRows: BizReportEnvelope['data']['list']
  let metaRows: BizCampaignRow[]
  if (shop.mode === 'live') {
    ;[reportRows, metaRows] = await Promise.all([
      fetchCampaignReport(bizCredsFromShop(shop), start, end),
      fetchCampaignMeta(bizCredsFromShop(shop)),
    ])
  } else {
    reportRows = loadFixture<BizReportEnvelope>('biz_report_campaign.json').data.list
    metaRows = loadFixture<BizCampaignEnvelope>('biz_campaign_get.json').data.list
  }
  const meta = new Map(metaRows.map((m) => [m.campaign_id, m]))
  return normalizeCampaigns(reportRows, meta, brand)
}

/** TikTok Ads campaigns across a brand's shops, merged. */
async function campaigns(start: string, end: string, brand: string): Promise<BizCampaign[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => campaignsForShop(s, start, end, brand))
  return mergeCampaigns(per)
}

/** Daily series for ONE shop (sample fixtures or live API), same normalizer. */
async function dailySeriesForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<DailyRow[]> {
  let analytics: AnalyticsEnvelope
  let finance: FinanceEnvelope
  if (shop.mode === 'live') {
    // end is inclusive from the client's perspective; TikTok windows are often
    // [ge, lt), so pass end+1 day as the exclusive bound.
    const endExclusive = addDays(end, 1)
    ;[analytics, finance] = await Promise.all([
      fetchAnalytics(credsFromShop(shop), start, endExclusive),
      fetchFinanceStatements(credsFromShop(shop), start, endExclusive),
    ])
  } else {
    analytics = loadFixture<AnalyticsEnvelope>('analytics_shop_performance.json')
    finance = loadFixture<FinanceEnvelope>('finance_statements.json')
  }
  // Fetch per-day ad spend and inject it as DailyRow.ads (profit recomputed in
  // the normalizer so the P&L identity holds). Days with no spend -> 0.
  const adsByDay = await adSpendByDayForShop(shop, start, shop.mode === 'live' ? addDays(end, 1) : end)
  // "today" anchors the off (days-ago) field; use the end of the requested window.
  const today = new Date(end + 'T00:00:00Z')
  const rows = normalizeDailySeries(analytics, finance, today, adsByDay)
  // Clamp to the requested [start, end] window.
  return rows.filter((r) => r.date >= start && r.date <= end)
}

/** Daily series across a brand's TikTok shops, merged day-by-day. */
async function dailySeries(start: string, end: string, brand: string): Promise<DailyRow[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => dailySeriesForShop(s, start, end))
  return mergeDailyRows(per)
}

/** Build Shopee Open API v2 creds from a shop's stored credentials (live only). */
function shopeeCredsFromShop(shop: ShopRow): ShopeeCreds {
  const c = shop.credentials
  const missing = (['partnerId', 'partnerKey', 'accessToken', 'shopId'] as const).filter(
    (k) => !c[k],
  )
  if (missing.length)
    throw new Error(`shop "${shop.name}" (live) thiếu credential: ${missing.join(', ')}`)
  return {
    partnerId: c.partnerId!,
    partnerKey: c.partnerKey!,
    accessToken: c.accessToken!,
    shopId: c.shopId!,
    baseUrl: c.baseUrl || SHOPEE_BASE_URL,
  }
}

/** Unix SECONDS for the start of a YYYY-MM-DD local (Asia/Ho_Chi_Minh) day. */
function localDayStartSec(date: string): number {
  return Date.parse(date + 'T00:00:00Z') / 1000 - 7 * 3600
}

/** Shopee per-day CPC ad spend for ONE shop (sample or live), by YYYY-MM-DD. */
async function shopeeAdSpendByDayForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  let rows: AdsDailyRow[]
  if (shop.mode === 'live') {
    rows = await fetchAdsDaily(shopeeCredsFromShop(shop), start, end)
  } else {
    rows = loadFixture<{ response: { daily_performance_list: AdsDailyRow[] } }>(
      'shopee_ads_daily.json',
    ).response.daily_performance_list
  }
  const spend = normalizeShopeeDailySpend(rows)
  return new Map(spend.map((s) => [s.date, s.adSpend]))
}

/** Shopee CPC ad campaigns for ONE shop (sample or live), normalized. */
async function shopeeCampaignsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  brand: string,
): Promise<ShopeeCampaign[]> {
  let rows: AdsCampaignRow[]
  if (shop.mode === 'live') {
    // TODO enumerate campaign ids (get_product_campaign_setting_info / internal list).
    rows = await fetchAdsCampaigns(shopeeCredsFromShop(shop), start, end, [])
  } else {
    rows = loadFixture<{ response: { campaign_list: AdsCampaignRow[] } }>(
      'shopee_ads_campaign.json',
    ).response.campaign_list
  }
  return normalizeShopeeCampaigns(rows, brand)
}

/** Shopee CPC ad campaigns across a brand's shops, merged. */
async function shopeeCampaigns(start: string, end: string, brand: string): Promise<ShopeeCampaign[]> {
  const shops = await freshShops('shopee', brand)
  const per = await fetchPerShop(shops, (s) => shopeeCampaignsForShop(s, start, end, brand))
  return mergeCampaigns(per)
}

/** Shopee daily series for ONE shop (sample or signed live calls), same normalizer. */
async function shopeeDailySeriesForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<ShopeeDailyRow[]> {
  let orders: OrderDetail[]
  let escrow: Map<string, OrderIncome>
  if (shop.mode === 'live') {
    // Window [start 00:00, end+1 00:00) in local seconds.
    const timeFrom = localDayStartSec(start)
    const timeTo = localDayStartSec(addDays(end, 1))
    const pulled = await fetchOrdersAndEscrow(shopeeCredsFromShop(shop), timeFrom, timeTo)
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
  const adsByDay = await shopeeAdSpendByDayForShop(shop, start, end)
  const today = new Date(end + 'T00:00:00Z')
  const rows = normalizeShopeeDailySeries(orders, escrow, today, adsByDay)
  // Clamp to the requested [start, end] window.
  return rows.filter((r) => r.date >= start && r.date <= end)
}

/** Shopee daily series across a brand's shops, merged day-by-day. */
async function shopeeDailySeries(start: string, end: string, brand: string): Promise<ShopeeDailyRow[]> {
  const shops = await freshShops('shopee', brand)
  const per = await fetchPerShop(shops, (s) => shopeeDailySeriesForShop(s, start, end))
  return mergeDailyRows(per)
}

/** TikTok affiliate creators for ONE shop (sample or live), normalized. */
async function tiktokCreatorsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  brand: string,
): Promise<Creator[]> {
  let orders: AffiliateOrder[]
  if (shop.mode === 'live') {
    orders = await fetchAffiliateOrders(credsFromShop(shop), start, addDays(end, 1))
  } else {
    orders = loadFixture<AffiliateOrdersEnvelope>('affiliate_orders.json').data.orders
  }
  return normalizeCreators(orders, brand)
}

/** TikTok affiliate creators across a brand's shops, merged. */
async function tiktokCreators(start: string, end: string, brand: string): Promise<Creator[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => tiktokCreatorsForShop(s, start, end, brand))
  return mergeCreators(per)
}

/** TikTok top products for ONE shop (sample or live), margin via store cogs + net ratio. */
async function tiktokTopProductsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  brand: string,
): Promise<TiktokProductPerf[]> {
  let products: ShopProduct[]
  if (shop.mode === 'live') {
    products = await fetchShopProducts(credsFromShop(shop), start, addDays(end, 1))
  } else {
    products = loadFixture<ShopProductsEnvelope>('tiktok_shop_products.json').data.products
  }
  const netRatio = netRatioOf(await dailySeriesForShop(shop, start, end))
  const rows = normalizeTiktokTopProducts(products, buildCatalog(), netRatio)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** TikTok top products across a brand's shops, merged by sku. */
async function tiktokTopProducts(
  start: string,
  end: string,
  brand: string,
): Promise<TiktokProductPerf[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => tiktokTopProductsForShop(s, start, end, brand))
  return mergeTopProducts(per)
}

/** TikTok recon orders for ONE shop (sample or live), fees from finance normalization. */
async function tiktokReconOrdersForShop(
  shop: ShopRow,
  brand: string,
): Promise<TiktokReconOrder[]> {
  let search: OrderSearchEnvelope
  let finance: FinanceEnvelope
  let analytics: AnalyticsEnvelope
  if (shop.mode === 'live') {
    ;[search, finance, analytics] = await Promise.all([
      fetchOrderSearch(credsFromShop(shop), '2026-06-19', '2026-07-03'), // TODO window from caller
      fetchFinanceStatements(credsFromShop(shop), '2026-06-19', '2026-07-03'),
      fetchAnalytics(credsFromShop(shop), '2026-06-19', '2026-07-03'),
    ])
  } else {
    search = loadFixture<OrderSearchEnvelope>('tiktok_order_search.json')
    finance = loadFixture<FinanceEnvelope>('finance_statements.json')
    analytics = loadFixture<AnalyticsEnvelope>('analytics_shop_performance.json')
  }
  const rows = normalizeTiktokRecon(search, finance, buildCatalog(), analytics)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** TikTok recon orders across a brand's shops, merged. */
async function tiktokReconOrders(brand: string): Promise<TiktokReconOrder[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => tiktokReconOrdersForShop(s, brand))
  return mergeRecon(per)
}

/** Shopee order details + escrow for ONE shop (sample fixtures or live). */
async function shopeeOrdersAndEscrowForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<{ orders: OrderDetail[]; escrow: Map<string, OrderIncome> }> {
  if (shop.mode === 'live') {
    const timeFrom = localDayStartSec(start)
    const timeTo = localDayStartSec(addDays(end, 1))
    return fetchOrdersAndEscrow(shopeeCredsFromShop(shop), timeFrom, timeTo)
  }
  const orders = loadFixture<OrderDetailResponse>('shopee_order_detail.json').response.order_list
  const rawEscrow = loadFixture<{ orders: { order_sn: string; order_income: OrderIncome }[] }>(
    'shopee_escrow.json',
  )
  return { orders, escrow: new Map(rawEscrow.orders.map((e) => [e.order_sn, e.order_income])) }
}

/** Shopee top products for ONE shop (sample or live), margin via store cogs + net ratio. */
async function shopeeTopProductsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  brand: string,
): Promise<ShopeeProductPerf[]> {
  const { orders } = await shopeeOrdersAndEscrowForShop(shop, start, end)
  const netRatio = netRatioOf(await shopeeDailySeriesForShop(shop, start, end))
  const rows = normalizeShopeeTopProducts(orders, buildCatalog() as ShopeeCatalog, netRatio)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** Shopee top products across a brand's shops, merged by sku. */
async function shopeeTopProducts(
  start: string,
  end: string,
  brand: string,
): Promise<ShopeeProductPerf[]> {
  const shops = await freshShops('shopee', brand)
  const per = await fetchPerShop(shops, (s) => shopeeTopProductsForShop(s, start, end, brand))
  return mergeTopProducts(per)
}

/** Shopee recon orders for ONE shop (sample or live), fees from escrow normalization. */
async function shopeeReconOrdersForShop(
  shop: ShopRow,
  brand: string,
): Promise<ShopeeReconOrder[]> {
  const { orders, escrow } = await shopeeOrdersAndEscrowForShop(shop, '2026-06-19', '2026-07-02')
  const rows = normalizeShopeeRecon(orders, escrow, buildCatalog() as ShopeeCatalog)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** Shopee recon orders across a brand's shops, merged (most recent first). */
async function shopeeReconOrders(brand: string): Promise<ShopeeReconOrder[]> {
  const shops = await freshShops('shopee', brand)
  const per = await fetchPerShop(shops, (s) => shopeeReconOrdersForShop(s, brand))
  return mergeRecon(per, 60)
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---- TikTok Shop OAuth (seller authorization → tokens + shop_cipher) ----
// The seller-authorization page; after consent TikTok redirects to the app's REGISTERED
// redirect URL (set this to <public>/api/tiktok/oauth/callback in the Partner app).
const TIKTOK_AUTH_PAGE =
  process.env.TIKTOK_AUTH_PAGE ?? 'https://services.tiktokshop.com/open/authorize'
// Short-lived CSRF/state map: state -> shopId (single BFF process, in-memory is fine).
const oauthStates = new Map<string, { shopId: number; exp: number }>()
function newOAuthState(shopId: number): string {
  const s = crypto.randomBytes(16).toString('hex')
  oauthStates.set(s, { shopId, exp: Date.now() + 10 * 60_000 })
  return s
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
/** Small self-closing result page shown in the OAuth popup. */
function oauthResultPage(ok: boolean, msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>TikTok OAuth</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:44px;text-align:center;background:#f7f8fb">
<div style="font-size:52px">${ok ? '✅' : '❌'}</div>
<h2 style="color:${ok ? '#0f9d6b' : '#b3261e'};margin:8px 0">${ok ? 'Kết nối thành công' : 'Kết nối thất bại'}</h2>
<p style="color:#555;max-width:540px;margin:12px auto;font-size:14px;line-height:1.5">${escapeHtml(msg)}</p>
<p style="color:#999;font-size:12.5px">Cửa sổ sẽ tự đóng…</p>
<script>try{if(window.opener)window.opener.postMessage('tiktok-oauth-done','*')}catch(e){}setTimeout(function(){window.close()},2600)</script>
</body></html>`
}

/**
 * Probe a shop's connectivity with a single lightweight real API call. Sample shops
 * short-circuit to OK (no creds needed). Live shops make one signed call per platform
 * (TikTok analytics; +Ads report if biz creds set / Shopee order list) and surface the
 * platform's own error message on failure. Never throws — always resolves a result.
 */
async function testShopConnection(
  shop: ShopRow,
): Promise<{ ok: boolean; message: string }> {
  if (shop.mode === 'sample') {
    return {
      ok: true,
      message: 'Shop đang ở chế độ sample — dùng dữ liệu mẫu, chưa gọi API thật. Chuyển sang LIVE để test kết nối thật.',
    }
  }
  // Real-clock 2-day window; for a connection probe the exact dates don't matter.
  const end = new Date().toISOString().slice(0, 10)
  const start = addDays(end, -2)
  try {
    if (shop.platform === 'tiktok') {
      await fetchAnalytics(credsFromShop(shop), start, addDays(end, 1))
      let adsNote = ''
      if (shop.credentials.bizAccessToken && shop.credentials.advertiserId) {
        await fetchDailyReport(bizCredsFromShop(shop), start, end)
        adsNote = ' + Ads (Business) API OK'
      }
      return { ok: true, message: `Kết nối TikTok Shop OK${adsNote}.` }
    }
    const now = Math.floor(Date.now() / 1000)
    await pingOrders(shopeeCredsFromShop(shop), now - 2 * 86400, now)
    return { ok: true, message: 'Kết nối Shopee OK.' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  // Mode is now per-shop (see /api/shops); report shop counts instead of a global mode.
  const shops = storeListShopsMasked()
  const live = shops.filter((s) => s.mode === 'live').length
  res.json({ ok: true, port: PORT, shops: shops.length, liveShops: live })
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
    const rows = await dailySeries(start, end, brand)
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
    const list = await campaigns(start, end, brand)
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
    const rows = await shopeeDailySeries(start, end, brand)
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

// ---- brands + shops (multi-brand / multi-shop config; CEO-only in the UI) ----

app.get('/api/brands', (_req, res) => {
  res.json(storeListBrands())
})

app.post('/api/brands', (req, res) => {
  const b = req.body ?? {}
  if (typeof b.name !== 'string' || !b.name.trim()) {
    res.status(400).json({ error: 'name required' })
    return
  }
  try {
    res.json(storeAddBrand({ key: b.key, name: b.name.trim() }))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

app.put('/api/brands/:id', (req, res) => {
  const b = req.body ?? {}
  const updated = storeUpdateBrand(Number(req.params.id), {
    name: typeof b.name === 'string' ? b.name : undefined,
    active: typeof b.active === 'boolean' ? b.active : undefined,
  })
  if (!updated) {
    res.status(404).json({ error: 'brand not found' })
    return
  }
  res.json(updated)
})

app.delete('/api/brands/:id', (req, res) => {
  try {
    const ok = storeDeleteBrand(Number(req.params.id))
    res.status(ok ? 200 : 404).json({ ok })
  } catch (err) {
    res.status(409).json({ error: (err as Error).message })
  }
})

app.get('/api/shops', (req, res) => {
  const brand = req.query.brand as string | undefined
  const platform = req.query.platform as 'tiktok' | 'shopee' | undefined
  res.json(storeListShopsMasked({ brandKey: brand, platform }))
})

app.post('/api/shops', (req, res) => {
  const s = req.body ?? {}
  if (!s.brandKey || (s.platform !== 'tiktok' && s.platform !== 'shopee') || !s.name) {
    res.status(400).json({ error: 'brandKey, platform (tiktok|shopee), name required' })
    return
  }
  if (s.mode && s.mode !== 'sample' && s.mode !== 'live') {
    res.status(400).json({ error: 'mode must be sample|live' })
    return
  }
  const brandExists = storeListBrands().some((b) => b.key === s.brandKey)
  if (!brandExists) {
    res.status(400).json({ error: `brand '${s.brandKey}' không tồn tại` })
    return
  }
  res.json(
    storeAddShop({
      brandKey: s.brandKey,
      platform: s.platform,
      name: s.name,
      mode: s.mode,
      active: s.active,
      credentials: s.credentials,
    }),
  )
})

app.put('/api/shops/:id', (req, res) => {
  const s = req.body ?? {}
  if (s.mode && s.mode !== 'sample' && s.mode !== 'live') {
    res.status(400).json({ error: 'mode must be sample|live' })
    return
  }
  const updated = storeUpdateShop(Number(req.params.id), {
    name: typeof s.name === 'string' ? s.name : undefined,
    mode: s.mode,
    active: typeof s.active === 'boolean' ? s.active : undefined,
    credentials:
      s.credentials && typeof s.credentials === 'object' ? s.credentials : undefined,
  })
  if (!updated) {
    res.status(404).json({ error: 'shop not found' })
    return
  }
  res.json(updated)
})

app.delete('/api/shops/:id', (req, res) => {
  const ok = storeDeleteShop(Number(req.params.id))
  res.status(ok ? 200 : 404).json({ ok })
})

app.post('/api/shops/:id/test', async (req, res) => {
  const shop = storeGetShop(Number(req.params.id))
  if (!shop) {
    res.status(404).json({ ok: false, message: 'shop not found' })
    return
  }
  // Auto-refresh an expiring token first, then probe, then persist the outcome so the
  // shop list shows the latest status + timestamp.
  const fresh = await withFreshToken(shop)
  const result = await testShopConnection(fresh)
  storeRecordShopTest(fresh.id, result.ok, result.message, new Date().toISOString())
  res.json(result)
})

// Start TikTok Shop seller authorization: redirect the popup to TikTok's consent page.
app.get('/api/tiktok/oauth/start', (req, res) => {
  const shop = storeGetShop(Number(req.query.shopId))
  if (!shop || shop.platform !== 'tiktok') {
    res.status(404).send(oauthResultPage(false, 'Shop TikTok không tồn tại.'))
    return
  }
  const c = shop.credentials
  if (!c.serviceId) {
    res
      .status(400)
      .send(
        oauthResultPage(
          false,
          'Shop chưa có Service ID. Mở Credential của shop, nhập "Service ID" (lấy từ app trên TikTok Partner Center) và lưu, rồi bấm Kết nối lại.',
        ),
      )
    return
  }
  const state = newOAuthState(shop.id)
  res.redirect(`${TIKTOK_AUTH_PAGE}?service_id=${encodeURIComponent(c.serviceId)}&state=${state}`)
})

// Manual auth_code exchange (fallback when the redirect callback can't be used, e.g.
// custom/ERP apps whose redirect URL can't point here). The user authorizes, copies the
// `code` from the address bar, and pastes it — same exchange as the callback.
app.post('/api/shops/:id/oauth/exchange', async (req, res) => {
  const shop = storeGetShop(Number(req.params.id))
  if (!shop || shop.platform !== 'tiktok') {
    res.status(404).json({ ok: false, message: 'Shop TikTok không tồn tại.' })
    return
  }
  const authCode = String((req.body ?? {}).authCode ?? '').trim()
  if (!authCode) {
    res.status(400).json({ ok: false, message: 'Thiếu auth_code.' })
    return
  }
  const c = shop.credentials
  if (!c.appKey || !c.appSecret) {
    res.status(400).json({ ok: false, message: 'Shop thiếu App Key / App Secret.' })
    return
  }
  try {
    const tok = await exchangeTikTokCode(c.appKey, c.appSecret, authCode)
    let cipher: string | undefined
    let shopName: string | undefined
    try {
      const shops = await fetchAuthorizedShops(
        c.appKey,
        c.appSecret,
        tok.accessToken,
        c.baseUrl || BASE_URL,
      )
      cipher = shops[0]?.cipher
      shopName = shops[0]?.name
    } catch (e) {
      console.warn('[oauth] fetch authorized shops failed:', (e as Error).message)
    }
    storeSetShopTokens(shop.id, { ...tok, shopCipher: cipher })
    res.json({
      ok: true,
      message:
        `Đã lấy access token + refresh token${shopName ? ` cho shop "${shopName}"` : ''}. ` +
        (cipher ? 'Đã tự điền shop_cipher.' : 'CHƯA lấy được shop_cipher — kiểm tra quyền Authorization của app.'),
    })
  } catch (err) {
    res.status(502).json({ ok: false, message: (err as Error).message })
  }
})

// OAuth callback: exchange auth_code -> tokens, discover shop_cipher, save to the shop.
// Register <public-url>/api/tiktok/oauth/callback as the app's redirect URL in Partner Center.
app.get('/api/tiktok/oauth/callback', async (req, res) => {
  const code = String(req.query.code ?? req.query.auth_code ?? '')
  const state = String(req.query.state ?? '')
  const entry = oauthStates.get(state)
  oauthStates.delete(state)
  if (!code) {
    res.status(400).send(oauthResultPage(false, 'TikTok không trả về auth code.'))
    return
  }
  if (!entry || entry.exp < Date.now()) {
    res.status(400).send(oauthResultPage(false, 'Phiên kết nối hết hạn hoặc không hợp lệ. Thử lại.'))
    return
  }
  const shop = storeGetShop(entry.shopId)
  if (!shop || !shop.credentials.appKey || !shop.credentials.appSecret) {
    res.status(400).send(oauthResultPage(false, 'Shop thiếu App Key/App Secret.'))
    return
  }
  const c = shop.credentials
  try {
    const tok = await exchangeTikTokCode(c.appKey!, c.appSecret!, code)
    let cipher: string | undefined
    let shopName: string | undefined
    try {
      const shops = await fetchAuthorizedShops(
        c.appKey!,
        c.appSecret!,
        tok.accessToken,
        c.baseUrl || BASE_URL,
      )
      cipher = shops[0]?.cipher
      shopName = shops[0]?.name
    } catch (e) {
      console.warn('[oauth] fetch authorized shops failed:', (e as Error).message)
    }
    storeSetShopTokens(entry.shopId, { ...tok, shopCipher: cipher })
    res.send(
      oauthResultPage(
        true,
        `Đã lấy access token + refresh token${shopName ? ` cho shop "${shopName}"` : ''}. ` +
          (cipher ? 'Đã tự điền shop_cipher.' : 'Chưa lấy được shop_cipher — kiểm tra quyền Authorization của app.'),
      ),
    )
  } catch (err) {
    res.status(502).send(oauthResultPage(false, (err as Error).message))
  }
})

app.listen(PORT, () => {
  const shops = storeListShopsMasked()
  const live = shops.filter((s) => s.mode === 'live').length
  console.log(
    `BFF listening on :${PORT} (${storeListBrands().length} brands, ${shops.length} shops, ` +
      `${live} live; shop=${BASE_URL}, biz=${BIZ_BASE_URL}, shopeeApi=${SHOPEE_BASE_URL})`,
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
