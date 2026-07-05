// Backend BFF: signs + calls TikTok (Shop Partner API + API for Business) and
// Shopee (Open API v2) server-side (live) OR loads official-shaped fixtures
// (sample), runs BOTH through the same per-platform normalizers, and returns
// already-normalized DailyRow[]/Campaign[] JSON. The browser never sees any
// app_secret / partner_key. TikTok and Shopee have independent sample|live modes.

import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import 'dotenv/config'

import {
  normalizeCreators,
  normalizeDailyFromOrders,
  normalizeReconOrders as normalizeTiktokRecon,
  normalizeTopProductsFromOrders as normalizeTiktokTopProductsFromOrders,
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
import { fetchOrderSearch } from './tiktok/catalogClient'
import type {
  Creator,
  DailyRow,
  FinanceEnvelope,
  OrderSearchEnvelope,
  ProductPerf as TiktokProductPerf,
  ReconOrder as TiktokReconOrder,
  SearchedOrder,
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
  loadDailyRows,
  saveDailyRows,
  loadSnapshot,
  saveSnapshot,
  getApiCacheStats,
  flushApiCache,
  saveRawOrders,
  loadRawOrders,
  loadRawOrderIncomeMap,
  saveHourlySnapshot,
  getRawOrdersCount,
  saveReconCache,
  loadReconCache,
  warmReconCacheFromSnapshots,
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
import { memo } from './cache'
import { requireAuth, setSession, clearSession, getSessionUserId } from './session'
import { checkLogin, getUser } from './store/db'

/** In-memory dedup TTL for per-shop DB reads (poller refreshes DB every 60s). */
const SHOP_TTL = 30_000

import { publicSign as shopeePublicSign } from './shopee/sign'
import { normalizeCampaigns, normalizeDailySpend } from './tiktokbiz/normalize'
import {
  fetchCampaignMeta,
  fetchCampaignReport,
  fetchDailyReport,
  type TikTokBizCreds,
} from './tiktokbiz/client'
import type {
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
import { fetchOrdersAndEscrow, fetchOrdersOnly, pingOrders, type ShopeeCreds } from './shopee/client'
import { fetchAdsCampaigns, fetchAdsDaily, fetchCampaignIds, fetchCampaignNames } from './shopee/adsClient'
import type {
  AdsCampaignRow,
  Campaign as ShopeeCampaign,
  Catalog as ShopeeCatalog,
  DailyRow as ShopeeDailyRow,
  OrderDetail,
  OrderIncome,
  ProductPerf as ShopeeProductPerf,
  ReconOrder as ShopeeReconOrder,
} from './shopee/types'

const PORT = Number(process.env.PORT ?? 8790)
const BASE_URL = process.env.TIKTOK_BASE_URL ?? 'https://open-api.tiktokglobalshop.com'
const BIZ_BASE_URL = process.env.TIKTOK_BIZ_BASE_URL ?? 'https://business-api.tiktok.com'
const SHOPEE_BASE_URL = process.env.SHOPEE_BASE_URL ?? 'https://partner.shopeemobile.com'

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
/** Chi tiêu ads đã lưu sẵn trong daily_data — fallback khi API ads lỗi (429/5xx),
 *  để không ghi đè chi tiêu thật đã biết bằng 0 (cost tụt tạm thời trên chart giờ). */
function savedAdSpendByDay(
  shop: ShopRow,
  platform: string,
  start: string,
  end: string,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [date, row] of loadDailyRows<{ ads?: number }>(shop.id, platform, start, end)) {
    if (typeof row.ads === 'number' && row.ads > 0) out.set(date, row.ads)
  }
  return out
}

async function adSpendByDayForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  if (shop.mode !== 'live') return new Map()
  // Ads (TikTok API for Business) is OPTIONAL: if no creds or call fails, treat as 0.
  const c = shop.credentials
  if (!c.bizAccessToken || !c.advertiserId) return new Map()
  let rows: BizReportEnvelope['data']['list']
  try {
    rows = await fetchDailyReport(bizCredsFromShop(shop), start, end)
  } catch (err) {
    console.warn(`[shop ${shop.id} "${shop.name}" ads] lỗi ads, dùng chi tiêu đã lưu: ${(err as Error).message}`)
    return savedAdSpendByDay(shop, 'tiktok', start, end)
  }
  const spend = normalizeDailySpend(rows)
  return new Map(spend.map((s) => [s.date, s.adSpend]))
}

/** TikTok Ads campaigns for ONE shop — reads ONLY from DB snapshot.
 *  The poller saves this snapshot every 60s. Returns [] if not yet populated. */
async function campaignsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  _brand: string,
): Promise<BizCampaign[]> {
  if (shop.mode !== 'live') return []
  const period = `${start}:${end}`
  return loadSnapshot<BizCampaign>(shop.id, 'tiktok', 'campaigns', period) ?? []
}

/** TikTok Ads campaigns across a brand's shops, merged. */
async function campaigns(start: string, end: string, brand: string): Promise<BizCampaign[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => campaignsForShop(s, start, end, brand))
  return mergeCampaigns(per)
}

/** Daily series for ONE shop (sample fixtures or live API), same normalizer. Cached. */
async function dailySeriesForShop(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<DailyRow[]> {
  return memo(`daily:${shop.id}:${shop.mode}:${start}:${end}`, SHOP_TTL, () =>
    dailySeriesForShopRaw(shop, start, end),
  )
}

async function dailySeriesForShopRaw(
  shop: ShopRow,
  start: string,
  end: string,
): Promise<DailyRow[]> {
  if (shop.mode !== 'live') return []

  // Live mode: read ONLY from DB — poller (60s) is the sole data source.
  const allDates = datesBetween(start, end)
  const cached = loadDailyRows<DailyRow>(shop.id, 'tiktok', start, end)
  return allDates.map((d) => cached.get(d)).filter(Boolean) as DailyRow[]
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
  if (shop.mode !== 'live') return new Map()
  // Ads spend is OPTIONAL for daily rows: a 429/limit error must NOT kill order saving.
  // Shopee caps the range at 1 month → chunk ≤28 days. memo caches only SUCCESS
  // (cache.ts drops rejected promises), so an error retries on the next cycle instead
  // of pinning zeros for 10 minutes; the adsClient queue+backoff absorbs 429 bursts.
  try {
    return await memo(`spads:${shop.id}:${start}:${end}`, 600_000, async () => {
      const out = new Map<string, number>()
      let s = start
      while (s <= end) {
        const chunkEnd = addDays(s, 27) <= end ? addDays(s, 27) : end
        const rows = await fetchAdsDaily(shopeeCredsFromShop(shop), s, chunkEnd)
        for (const r of normalizeShopeeDailySpend(rows)) out.set(r.date, (out.get(r.date) ?? 0) + r.adSpend)
        s = addDays(chunkEnd, 1)
      }
      return out
    })
  } catch (err) {
    console.warn(`[shop ${shop.id} "${shop.name}" sp-ads] lỗi ads, dùng chi tiêu đã lưu: ${(err as Error).message}`)
    return savedAdSpendByDay(shop, 'shopee', start, end)
  }
}

/** Shopee CPC ad campaigns for ONE shop — reads ONLY from DB snapshot.
 *  The poller saves this snapshot every 60s. Returns [] if not yet populated. */
async function shopeeCampaignsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  _brand: string,
): Promise<ShopeeCampaign[]> {
  if (shop.mode !== 'live') return []
  const period = `${start}:${end}`
  return loadSnapshot<ShopeeCampaign>(shop.id, 'shopee', 'campaigns', period) ?? []
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
  if (shop.mode !== 'live') return []

  // Live mode: read ONLY from DB — poller (60s) is the sole data source.
  const allDates = datesBetween(start, end)
  const cached = loadDailyRows<ShopeeDailyRow>(shop.id, 'shopee', start, end)
  return allDates.map((d) => cached.get(d)).filter(Boolean) as ShopeeDailyRow[]
}

/** Shopee daily series across a brand's shops, merged day-by-day. */
async function shopeeDailySeries(start: string, end: string, brand: string): Promise<ShopeeDailyRow[]> {
  const shops = await freshShops('shopee', brand)
  const per = await fetchPerShop(shops, (s) => shopeeDailySeriesForShop(s, start, end))
  return mergeDailyRows(per)
}

/** TikTok affiliate creators for ONE shop — reads ONLY from DB snapshot.
 *  The poller saves this snapshot every 60s. Returns [] if not yet populated. */
async function tiktokCreatorsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  _brand: string,
): Promise<Creator[]> {
  if (shop.mode !== 'live') return []
  const period = `${start}:${end}`
  return loadSnapshot<Creator>(shop.id, 'tiktok', 'creators', period) ?? []
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
  if (shop.mode !== 'live') return []

  // Read from DB only: poller (60s) maintains this snapshot from raw orders.
  const period = `${start}:${end}`
  const cached = loadSnapshot<TiktokProductPerf>(shop.id, 'tiktok', 'top_products', period, Number.MAX_SAFE_INTEGER)
  if (cached) return brand === 'group' ? cached : cached.filter((r) => r.brand === brand)

  // Fallback: compute from raw orders already in DB (no API call).
  const orders = loadRawOrders<SearchedOrder>(shop.id, 'tiktok', start, end)
  if (orders.length > 0) {
    const dailyMap = loadDailyRows<DailyRow>(shop.id, 'tiktok', start, end)
    const dailyArr = datesBetween(start, end).map((d) => dailyMap.get(d)).filter(Boolean) as DailyRow[]
    const rows = normalizeTiktokTopProductsFromOrders(orders, buildCatalog(), netRatioOf(dailyArr))
    return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
  }
  return []
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

/** TikTok recon orders for ONE shop — reads ONLY from DB, never calls live API.
 *  The poller (pollTikTokSnapshotsForShop, 60s) is the sole source that fetches
 *  finance statements and saves the recon snapshot. If no snapshot yet, we build
 *  from raw orders with empty finance (fees = 0, orders are still visible). */
async function tiktokReconOrdersForShop(
  shop: ShopRow,
  brand: string,
): Promise<TiktokReconOrder[]> {
  if (shop.mode !== 'live') return []

  // Fast path: poller pre-normalizes and saves to recon_cache (1 row, instant read).
  const cached = loadReconCache<TiktokReconOrder>(shop.id, 'tiktok')
  if (cached && cached.length > 0) {
    return brand === 'group' ? cached : cached.filter((r) => r.brand === brand)
  }

  // Cold-start fallback (poller not yet run): normalize from raw_orders on-the-fly.
  const end = vnToday()
  const start = addDays(end, -59)
  const dbOrders = loadRawOrders<SearchedOrder>(shop.id, 'tiktok', start, end)
  if (dbOrders.length === 0) return []

  const emptyFinance: FinanceEnvelope = { code: 0, message: 'ok', data: { statements: [] } }
  const rows = normalizeTiktokRecon(
    { code: 0, message: 'ok', data: { orders: dbOrders } } as OrderSearchEnvelope,
    emptyFinance,
    buildCatalog(),
  )
  saveReconCache(shop.id, 'tiktok', rows)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** TikTok recon orders across a brand's shops, merged. */
async function tiktokReconOrders(brand: string): Promise<TiktokReconOrder[]> {
  const shops = await freshShops('tiktok', brand)
  const per = await fetchPerShop(shops, (s) => tiktokReconOrdersForShop(s, brand))
  return mergeRecon(per)
}

/** Shopee order details + escrow for ONE shop (live only). */
/** Shopee top products for ONE shop (sample or live), margin via store cogs + net ratio. */
async function shopeeTopProductsForShop(
  shop: ShopRow,
  start: string,
  end: string,
  brand: string,
): Promise<ShopeeProductPerf[]> {
  if (shop.mode !== 'live') return []

  // Read from DB only: poller (60s) maintains snapshot from raw orders.
  const period = `${start}:${end}`
  const cached = loadSnapshot<ShopeeProductPerf>(shop.id, 'shopee', 'top_products', period, Number.MAX_SAFE_INTEGER)
  if (cached) return brand === 'group' ? cached : cached.filter((r) => r.brand === brand)

  // Fallback: compute from raw orders in DB (no API call).
  type SpOrderWithIncome = OrderDetail & { _income?: OrderIncome }
  const rawOrders = loadRawOrders<SpOrderWithIncome>(shop.id, 'shopee', start, end)
  if (rawOrders.length > 0) {
    const dailyMap = loadDailyRows<ShopeeDailyRow>(shop.id, 'shopee', start, end)
    const dailyArr = datesBetween(start, end).map((d) => dailyMap.get(d)).filter(Boolean) as ShopeeDailyRow[]
    const rows = normalizeShopeeTopProducts(rawOrders as OrderDetail[], buildCatalog() as ShopeeCatalog, netRatioOf(dailyArr))
    return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
  }
  return []
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

/** Shopee recon orders for ONE shop (live only).
 *  Reads ALL raw orders from DB (full 30-day window) so the orders page shows
 *  every order, not just the settled ones that have escrow data. Fees are shown
 *  for settled orders (escrow embedded by the recon poller); pending orders show
 *  GMV with fees = 0, isSettled = false. */
async function shopeeReconOrdersForShop(
  shop: ShopRow,
  brand: string,
): Promise<ShopeeReconOrder[]> {
  if (shop.mode !== 'live') return []

  // Fast path: poller pre-normalizes and saves to recon_cache (1 row, instant read).
  const cached = loadReconCache<ShopeeReconOrder>(shop.id, 'shopee')
  if (cached && cached.length > 0) {
    return brand === 'group' ? cached : cached.filter((r) => r.brand === brand)
  }

  // Cold-start fallback (poller not yet run): normalize from raw_orders on-the-fly.
  const end = vnToday()
  const start = addDays(end, -59)
  type SpOrderWithIncome = OrderDetail & { _income?: OrderIncome }
  const rawOrders = loadRawOrders<SpOrderWithIncome>(shop.id, 'shopee', start, end)
  if (rawOrders.length === 0) return []

  const escrowMap = new Map<string, OrderIncome>()
  for (const o of rawOrders) {
    if (o._income) escrowMap.set(o.order_sn, o._income)
  }
  const rows = normalizeShopeeRecon(rawOrders as OrderDetail[], escrowMap, buildCatalog() as ShopeeCatalog)
  saveReconCache(shop.id, 'shopee', rows)
  return brand === 'group' ? rows : rows.filter((r) => r.brand === brand)
}

/** Shopee recon orders across a brand's shops, merged (most recent first). */
async function shopeeReconOrders(brand: string): Promise<ShopeeReconOrder[]> {
  const shops = await freshShops('shopee', brand)
  const per = await fetchPerShop(shops, (s) => shopeeReconOrdersForShop(s, brand))
  return mergeRecon(per)
}

// ============================================================
// BACKGROUND POLLER — API → SQLite → Dashboard (60s interval)
// Dashboard functions above read ONLY from DB; this section is
// the only code that ever calls TikTok / Shopee APIs in live mode.
// ============================================================

const POLL_INTERVAL_MS = 60_000
/** Quick cycle window: only the last N days re-fetch every minute (older data is settled). */
const QUICK_DAYS = 3
/** Full 60-day sweep cadence — matches STALE_RECENT_MS (2h) used by the DB read TTLs. */
const FULL_SWEEP_MS = 2 * 60 * 60 * 1000

/** Fetch TikTok daily series from API and persist to daily_data table. */
async function pollTikTokDailyForShop(
  shop: ShopRow,
  start: string,
  end: string,
  full = false,
): Promise<void> {
  const endExclusive = addDays(end, 1)
  const liveCreds = credsFromShop(shop)
  // analytics/202405/shop/performance consistently 504s — skip it in the daily poller
  // and derive daily rows from orders + finance instead (normalizeDailyFromOrders).
  const [finance, orderEnvelope] = await Promise.all([
    fetchFinanceStatements(liveCreds, start, endExclusive).catch((err) => {
      console.warn(`[poller] shop ${shop.id} finance: ${(err as Error).message}`)
      return null
    }),
    // endExclusive here too: fetchOrderSearch's create_time_lt is the START of its end
    // day, so passing `end` would permanently exclude today's orders (the bug that made
    // TikTok lag a day behind Shopee).
    fetchOrderSearch(liveCreds, start, endExclusive).catch((err) => {
      console.warn(`[poller] shop ${shop.id} orders: ${(err as Error).message}`)
      return null
    }),
  ])
  // TikTok API hỏng chu kỳ này (5xx/504/timeout xảy ra thường xuyên) → GIỮ dữ liệu đã
  // lưu, chờ chu kỳ sau. Ghi đè bằng dữ liệu thiếu làm phí/GMV hôm nay tụt tạm thời
  // rồi bật lại — snapshot giờ dính đúng cú tụt đó (chart 7h: chi phí 0, lãi > GMV).
  if (!finance || !orderEnvelope) return
  const adsByDay = await adSpendByDayForShop(shop, start, endExclusive)
  const today = new Date(end + 'T00:00:00Z')
  const rows = normalizeDailyFromOrders(
    orderEnvelope.data.orders ?? [],
    finance,
    today,
    adsByDay,
  ).filter((r) => r.date >= start && r.date <= end)
  saveDailyRows(shop.id, 'tiktok', rows as unknown as Array<{ date: string } & Record<string, unknown>>)
  snapshotHour(shop.id, 'tiktok', rows)
  saveRawOrders(
    shop.id, 'tiktok',
    (orderEnvelope.data.orders ?? []).map((o) => ({
      order_sn: o.id,
      create_time_secs: o.create_time ?? 0,
      data: o,
    })),
  )
  // Full sweeps only: rebuild recon_cache from the 60-day orders + finance already in
  // hand, so Orders/Recon pages keep seeing NEW orders without a BFF restart. (Before,
  // the cache was written only on cold-start and went permanently stale.) Bonus: with
  // real finance in hand the per-order fees are populated instead of 0.
  if (full) {
    const reconRows = normalizeTiktokRecon(orderEnvelope, finance, buildCatalog())
    saveReconCache(shop.id, 'tiktok', reconRows)
  }
}

/** Fetch Shopee daily series from API and persist to daily_data table. */
async function pollShopeeDailyForShop(shop: ShopRow, start: string, end: string): Promise<void> {
  // Skip escrow (per-order API calls) in the daily poll — too slow for large windows.
  // Escrow is fetched separately in pollShopeeSnapshotsForShop for the recon period.
  const timeFrom = localDayStartSec(start)
  const timeTo = localDayStartSec(addDays(end, 1))
  const orders = await fetchOrdersOnly(shopeeCredsFromShop(shop), timeFrom, timeTo)
  const adsByDay = await shopeeAdSpendByDayForShop(shop, start, end)
  const today = new Date(end + 'T00:00:00Z')
  const rows = normalizeShopeeDailySeries(orders, new Map(), today, adsByDay).filter(
    (r) => r.date >= start && r.date <= end,
  )
  saveDailyRows(shop.id, 'shopee', rows as unknown as Array<{ date: string } & Record<string, unknown>>)
  snapshotHour(shop.id, 'shopee', rows)
  // PRESERVE previously-embedded escrow: this save used to write `data: o` (no _income),
  // wiping the income the snapshots phase had attached — one reason fees stayed 0.
  const incomeKeep = loadRawOrderIncomeMap(shop.id, start, end)
  saveRawOrders(
    shop.id, 'shopee',
    orders.map((o) => ({
      order_sn: o.order_sn,
      create_time_secs: o.create_time ?? 0,
      data: { ...o, _income: incomeKeep.get(o.order_sn) ?? null },
    })),
  )
}

/** Fetch TikTok snapshot data (campaigns, creators, products, recon) and persist. */
async function pollTikTokSnapshotsForShop(shop: ShopRow, start: string, end: string): Promise<void> {
  const period = `${start}:${end}`
  const brand = shop.brandKey

  if (shop.credentials.bizAccessToken && shop.credentials.advertiserId) {
    try {
      const [reportRows, metaRows] = await Promise.all([
        fetchCampaignReport(bizCredsFromShop(shop), start, end),
        fetchCampaignMeta(bizCredsFromShop(shop)),
      ])
      const meta = new Map(metaRows.map((m) => [m.campaign_id, m]))
      saveSnapshot(shop.id, 'tiktok', 'campaigns', period, normalizeCampaigns(reportRows, meta, brand))
    } catch (err) {
      console.warn(`[poller] TK campaigns shop ${shop.id}: ${(err as Error).message}`)
    }
  }

  try {
    // Affiliate seller orders API path is not publicly documented — skip gracefully.
    const orders = await fetchAffiliateOrders(credsFromShop(shop), start, addDays(end, 1))
    saveSnapshot(shop.id, 'tiktok', 'creators', period, normalizeCreators(orders, brand))
  } catch (err) {
    // 404 = affiliate orders endpoint not available for this app scope; non-fatal.
    const msg = (err as Error).message
    if (!msg.includes('HTTP 404')) console.warn(`[poller] TK creators shop ${shop.id}: ${msg}`)
  }

  // top_products and recon_cache are NOT rebuilt here — loading 20k raw orders
  // synchronously (better-sqlite3) blocks the event loop for 15-30s on every poll.
  // Instead: top_products route falls back to the requested period's raw orders (small),
  // and recon_cache is warmed at startup from existing snapshots + saved by route on
  // cold-start. The poller rebuilds recon_cache only after saving new raw orders (below).
}

/** Fetch Shopee snapshot data (campaigns, products, recon) and persist. */
async function pollShopeeSnapshotsForShop(shop: ShopRow, start: string, end: string): Promise<void> {
  const period = `${start}:${end}`
  const brand = shop.brandKey

  try {
    const creds = shopeeCredsFromShop(shop)
    // 1) Enumerate all product-level campaign ids (paginated).
    const ids = await fetchCampaignIds(creds)
    // 2) Daily performance, chunked ≤28 days (API caps the range at 1 month).
    const rows: AdsCampaignRow[] = []
    let s = start
    while (s <= end) {
      const chunkEnd = addDays(s, 27) <= end ? addDays(s, 27) : end
      rows.push(...(await fetchAdsCampaigns(creds, s, chunkEnd, ids)))
      s = addDays(chunkEnd, 1)
    }
    // 3) Names only for campaigns that actually spent in the window (keeps calls small
    //    and the m3 table clean — old closed campaigns are all-zero rows).
    const active = rows.filter((r) => Number(r.expense) > 0)
    const activeIds = [...new Set(active.map((r) => String(r.campaign_id)))]
    const names = await fetchCampaignNames(creds, activeIds)
    const named = active.map((r) => ({
      ...r,
      campaign_name: names.get(String(r.campaign_id))?.name ?? r.campaign_name,
    }))
    saveSnapshot(shop.id, 'shopee', 'campaigns', period, normalizeShopeeCampaigns(named, brand))
    // ALSO persist per-DAY rows (ISO dates, fixed key) so the dashboard can aggregate
    // EXACTLY the requested window (Hôm nay / 7 ngày / tuỳ chỉnh) instead of falling
    // back to a whole-sweep aggregate that ignores the filter.
    const asNum = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    const daily = named.map((r) => ({
      campaign_id: String(r.campaign_id),
      campaign_name: r.campaign_name,
      date: String(r.date ?? '').split('-').reverse().join('-'), // dd-mm-yyyy → YYYY-MM-DD
      impression: asNum(r.impression),
      clicks: asNum(r.clicks),
      expense: asNum(r.expense),
      broad_gmv: asNum(r.broad_gmv),
      broad_order: asNum(r.broad_order),
      direct_order: asNum(r.direct_order),
    }))
    saveSnapshot(shop.id, 'shopee', 'campaigns_daily', 'rolling', daily)
    console.log(
      `[poller] SP campaigns shop ${shop.id}: ${activeIds.length} chiến dịch có chi tiêu / ${ids.length} tổng`,
    )
  } catch (err) {
    console.warn(`[poller] SP campaigns shop ${shop.id}: ${(err as Error).message}`)
  }

  // top_products: NOT computed in poller (same event-loop-blocking reason as TikTok).
  // Route falls back to requested-period raw orders (UI-typical periods = small, fast).

  // Recon: cover the WHOLE sweep window (60d). The skip-set below makes escrow
  // incremental — after the one-time backfill pass, only NEW orders cost an API call.
  const reconEnd = end
  const reconStart = start
  try {
    const reconTimeFrom = localDayStartSec(reconStart)
    const reconTimeTo = localDayStartSec(addDays(reconEnd, 1))
    // INCREMENTAL escrow: only fetch income for orders that don't have it yet
    // (escrow = 1 API call per order; refetching thousands each sweep caused 429s).
    const existingIncome = loadRawOrderIncomeMap(shop.id, reconStart, reconEnd)
    const { orders: reconOrders, escrow: reconEscrow, escrowFailed } = await fetchOrdersAndEscrow(
      shopeeCredsFromShop(shop), reconTimeFrom, reconTimeTo, new Set(existingIncome.keys()),
    )
    console.log(
      `[poller] SP escrow shop ${shop.id}: +${reconEscrow.size} mới, ${existingIncome.size} đã có, ` +
        `${escrowFailed} lỗi / ${reconOrders.length} đơn (${reconStart}→${reconEnd})`,
    )
    // Embed income (new fetch first, else previously-stored) so routes read it from raw_orders.
    saveRawOrders(shop.id, 'shopee', reconOrders.map((o) => ({
      order_sn: o.order_sn,
      create_time_secs: o.create_time ?? 0,
      data: { ...o, _income: reconEscrow.get(o.order_sn) ?? existingIncome.get(o.order_sn) ?? null },
    })))
  } catch (err) {
    console.warn(`[poller] SP recon shop ${shop.id}: ${(err as Error).message}`)
  }

  // Rebuild recon_cache from the full raw window (escrow embedded above) so Orders/Recon
  // keep seeing new orders without a restart. Runs only on full sweeps (2h) — the ~1-2s
  // synchronous load is acceptable at that cadence.
  try {
    type SpOrderWithIncome = OrderDetail & { _income?: OrderIncome }
    const rawOrders = loadRawOrders<SpOrderWithIncome>(shop.id, 'shopee', start, end)
    if (rawOrders.length > 0) {
      const escrowMap = new Map<string, OrderIncome>()
      for (const o of rawOrders) if (o._income) escrowMap.set(o.order_sn, o._income)
      saveReconCache(
        shop.id,
        'shopee',
        normalizeShopeeRecon(rawOrders as OrderDetail[], escrowMap, buildCatalog() as ShopeeCatalog),
      )
    }
  } catch (err) {
    console.warn(`[poller] SP recon cache shop ${shop.id}: ${(err as Error).message}`)
  }
}

/**
 * One polling cycle. `full=false` (every 60s): re-fetch only the last QUICK_DAYS of
 * daily data — cheap, keeps today's numbers near-realtime. `full=true` (every 2h +
 * at boot): 60-day daily sweep AND the snapshots phase (campaigns / creators / Shopee
 * recon escrow) — those all sit behind 2h read-TTLs anyway, so polling them every
 * minute was pure waste (~95% of the API calls).
 */
async function pollOnce(full: boolean): Promise<void> {
  const end = vnToday()
  const start = addDays(end, full ? -59 : -(QUICK_DAYS - 1))
  let tktShops: ShopRow[] = []
  let spShops: ShopRow[] = []
  try {
    ;[tktShops, spShops] = await Promise.all([
      freshShops('tiktok', 'group').then((s) => s.filter((x) => x.mode === 'live')),
      freshShops('shopee', 'group').then((s) => s.filter((x) => x.mode === 'live')),
    ])
  } catch (err) {
    console.warn('[poller] cannot resolve shops:', (err as Error).message)
    return
  }
  if (tktShops.length === 0 && spShops.length === 0) return

  // Phase 1: daily data (must complete before snapshots that compute net ratio).
  await Promise.all([
    ...tktShops.map((s) =>
      pollTikTokDailyForShop(s, start, end, full).catch((e) =>
        console.warn(`[poller] TK daily shop ${s.id}: ${(e as Error).message}`),
      ),
    ),
    ...spShops.map((s) =>
      pollShopeeDailyForShop(s, start, end).catch((e) =>
        console.warn(`[poller] SP daily shop ${s.id}: ${(e as Error).message}`),
      ),
    ),
  ])

  // Phase 2 (full sweeps only): snapshots — campaigns / creators / Shopee recon escrow.
  if (full) {
    await Promise.all([
      ...tktShops.map((s) =>
        pollTikTokSnapshotsForShop(s, start, end).catch((e) =>
          console.warn(`[poller] TK snapshots shop ${s.id}: ${(e as Error).message}`),
        ),
      ),
      ...spShops.map((s) =>
        pollShopeeSnapshotsForShop(s, start, end).catch((e) =>
          console.warn(`[poller] SP snapshots shop ${s.id}: ${(e as Error).message}`),
        ),
      ),
    ])
  }
  console.log(
    `[poller] ✓ ${full ? 'full-60d' : `quick-${QUICK_DAYS}d`} — ${tktShops.length} TK + ${spShops.length} SP live shops — ${new Date().toISOString()}`,
  )
}

// Overlap guard: setInterval fires every 60s regardless of how long a cycle takes; a
// full sweep can run for minutes, and overlapping sweeps used to pile up concurrent
// API calls (self-inflicted rate-limiting). One cycle at a time; extra ticks skip.
let pollBusy = false
let lastFullSweepAt = 0

async function pollTick(): Promise<void> {
  if (pollBusy) return
  pollBusy = true
  try {
    const full = Date.now() - lastFullSweepAt >= FULL_SWEEP_MS
    await pollOnce(full)
    if (full) lastFullSweepAt = Date.now()
  } finally {
    pollBusy = false
  }
}

/** Start the background poller: full sweep at boot, then quick/full ticks every 60s. */
function startPoller(): void {
  console.log(`[poller] starting — quick ${QUICK_DAYS}d mỗi 60s, full 60d mỗi 2h, chống chồng vòng`)
  pollTick().catch((err) => console.warn('[poller] initial poll failed:', err))
  setInterval(() => pollTick().catch((err) => console.warn('[poller] poll error:', err)), POLL_INTERVAL_MS)
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Today's date in Asia/Ho_Chi_Minh (UTC+7). toISOString() alone is UTC: between
 *  00:00–07:00 VN it still returns YESTERDAY's date, making the poller lag a day. */
function vnToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

/** Current hour 0..23 in Asia/Ho_Chi_Minh. */
function vnHour(): number {
  return new Date(Date.now() + 7 * 3600_000).getUTCHours()
}

/** Upsert TODAY's cumulative daily row under the current VN hour (real hourly data).
 *  Runs every quick cycle; the last write within an hour ≈ totals through that hour. */
function snapshotHour(shopId: number, platform: string, rows: Array<{ date: string }>): void {
  const today = vnToday()
  const row = rows.find((r) => r.date === today)
  if (row) saveHourlySnapshot(shopId, platform, today, vnHour(), row as unknown as Record<string, unknown>)
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = []
  let cur = start
  while (cur <= end) {
    dates.push(cur)
    cur = addDays(cur, 1)
  }
  return dates
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
  const end = vnToday()
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
app.use(cors({ origin: process.env.APP_ORIGIN || true, credentials: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  // Mode is now per-shop (see /api/shops); report shop counts instead of a global mode.
  const shops = storeListShopsMasked()
  const live = shops.filter((s) => s.mode === 'live').length
  res.json({ ok: true, port: PORT, shops: shops.length, liveShops: live })
})

// ---- Authentication (no session required) ----

/** Return the currently logged-in user object, or null if no session. */
app.get('/api/auth/me', (req, res) => {
  const id = getSessionUserId(req)
  if (!id) { res.json(null); return }
  const user = getUser(id)
  res.json(user ?? null)
})

/** Login: validate email+password, issue a signed session cookie. */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = (req.body as Record<string, unknown>) ?? {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    res.status(400).json({ error: 'email và password là bắt buộc' })
    return
  }
  const user = checkLogin(email, password)
  if (!user) {
    res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' })
    return
  }
  setSession(res, user.id)
  res.json({ ok: true, user })
})

/** Logout: clear the session cookie. */
app.post('/api/auth/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

// OAuth callback: exchange auth_code -> tokens, discover shop_cipher, save to the shop.
// Register <public-url>/api/tiktok/oauth/callback as the app's redirect URL in Partner Center.
// MUST be before requireAuth — TikTok redirects here without a session cookie.
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

// Shopee OAuth: start (redirect to Shopee consent page)
app.get('/api/shopee/oauth/start', (req, res) => {
  const shop = storeGetShop(Number(req.query.shopId))
  if (!shop || shop.platform !== 'shopee') {
    res.status(404).send(oauthResultPage(false, 'Shop Shopee không tồn tại.'))
    return
  }
  const c = shop.credentials
  if (!c.partnerId || !c.partnerKey) {
    res.status(400).send(oauthResultPage(false, 'Shop chưa có Partner ID / Partner Key. Nhập và lưu trước.'))
    return
  }
  const state = newOAuthState(shop.id)
  const ts = Math.floor(Date.now() / 1000)
  const AUTH_PATH = '/api/v2/shop/auth_partner'
  const sign = shopeePublicSign(c.partnerId, c.partnerKey, AUTH_PATH, ts)
  const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`
  const callback = `${origin}/api/shopee/oauth/callback`
  const base = c.baseUrl || SHOPEE_BASE_URL
  const params = new URLSearchParams({
    partner_id: String(c.partnerId),
    redirect: callback,
    timestamp: String(ts),
    state,
    sign,
  })
  res.redirect(`${base}${AUTH_PATH}?${params.toString()}`)
})

// Shopee OAuth: callback — exchange code → access_token + refresh_token, persist.
// MUST be before requireAuth — Shopee redirects here without a session cookie.
// NOTE: Shopee does NOT pass state back in the callback URL (unlike TikTok),
// so we fall back to finding any pending Shopee OAuth entry in oauthStates.
app.get('/api/shopee/oauth/callback', async (req, res) => {
  const code = String(req.query.code ?? '')
  const shopIdFromCb = String(req.query.shop_id ?? '')
  const state = String(req.query.state ?? '')

  // Try exact state match first; if missing (Shopee omits it), scan for any pending Shopee shop.
  let entry = oauthStates.get(state)
  if (entry) {
    oauthStates.delete(state)
  } else {
    for (const [s, e] of oauthStates) {
      if (e.exp >= Date.now()) {
        const sh = storeGetShop(e.shopId)
        if (sh?.platform === 'shopee') {
          entry = e
          oauthStates.delete(s)
          break
        }
      }
    }
  }

  if (!code) {
    res.status(400).send(oauthResultPage(false, 'Shopee không trả về auth code.'))
    return
  }
  if (!entry || entry.exp < Date.now()) {
    res.status(400).send(oauthResultPage(false, 'Phiên kết nối hết hạn hoặc không hợp lệ. Thử lại.'))
    return
  }
  const shop = storeGetShop(entry.shopId)
  if (!shop || !shop.credentials.partnerId || !shop.credentials.partnerKey) {
    res.status(400).send(oauthResultPage(false, 'Shop thiếu Partner ID / Partner Key.'))
    return
  }
  const c = shop.credentials
  try {
    const TOKEN_PATH = '/api/v2/auth/token/get'
    const base = c.baseUrl || SHOPEE_BASE_URL
    const ts = Math.floor(Date.now() / 1000)
    const sign = shopeePublicSign(c.partnerId!, c.partnerKey!, TOKEN_PATH, ts)
    const qs = new URLSearchParams({ partner_id: String(c.partnerId), timestamp: String(ts), sign })
    const tokenRes = await fetch(`${base}${TOKEN_PATH}?${qs.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, partner_id: Number(c.partnerId), shop_id: Number(shopIdFromCb) }),
    })
    const json = (await tokenRes.json()) as {
      access_token?: string; refresh_token?: string; expire_in?: number
      error?: string; message?: string
    }
    if (!tokenRes.ok || json.error) throw new Error(`Shopee token error ${json.error}: ${json.message}`)
    if (!json.access_token) throw new Error('Shopee không trả về access_token.')
    const expiresAt = json.expire_in ? Math.floor(Date.now() / 1000) + json.expire_in : undefined
    storeSetShopTokens(entry.shopId, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenExpiresAt: expiresAt,
      shopId: shopIdFromCb || undefined,
    })
    res.send(oauthResultPage(
      true,
      `Kết nối Shopee thành công! Shop ID: ${shopIdFromCb}.` +
        (json.refresh_token ? ' Có refresh token — sẽ tự làm mới mỗi 4 giờ.' : ''),
    ).replace('tiktok-oauth-done', 'shopee-oauth-done'))
  } catch (err) {
    res.status(502).send(oauthResultPage(false, (err as Error).message))
  }
})

// All /api/* routes below require a valid session
app.use('/api/', requireAuth)

// ---- Cache management (protected) ----

app.get('/api/cache/stats', (_req, res) => {
  res.json({ ...getApiCacheStats(), rawOrders: getRawOrdersCount() })
})

app.delete('/api/cache/flush', (req, res) => {
  const shopId = req.query.shopId !== undefined ? Number(req.query.shopId) : undefined
  if (shopId !== undefined && isNaN(shopId)) {
    res.status(400).json({ error: 'shopId must be a number' })
    return
  }
  flushApiCache(shopId)
  res.json({ ok: true, flushed: shopId !== undefined ? `shop ${shopId}` : 'all' })
})

// ---- Data routes (protected) ----

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
    res.json(await memo(`tk-recon:${brand}`, 55_000, () => tiktokReconOrders(brand)))
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
    res.json(await memo(`sp-recon:${brand}`, 55_000, () => shopeeReconOrders(brand)))
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

app.listen(PORT, () => {
  const shops = storeListShopsMasked()
  const live = shops.filter((s) => s.mode === 'live').length
  console.log(
    `BFF listening on :${PORT} (${storeListBrands().length} brands, ${shops.length} shops, ` +
      `${live} live; shop=${BASE_URL}, biz=${BIZ_BASE_URL}, shopeeApi=${SHOPEE_BASE_URL})`,
  )
  // Warm recon_cache from existing snapshots so cold-start never blocks event loop.
  warmReconCacheFromSnapshots()
  if (live > 0) startPoller()
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
