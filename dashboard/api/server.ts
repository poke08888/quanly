// Lean read-API for the new dashboard. Serves ALL metrics purely from SQLite (via
// api/views.ts) — ZERO external TikTok/Shopee calls. Config CRUD + auth reuse the shared
// store. In prod it also serves the built web (same origin → cookie session, no CORS).
import 'dotenv/config' // APP_SECRET_KEY must match the old BFF so credential decryption + cookies agree
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { requireAuth, setSession, clearSession, getSessionUserId } from './session'
import {
  checkLogin,
  getUser,
  listCogs,
  upsertCogs,
  listBookings,
  addBooking,
  deleteBooking,
  listUsers,
  addUser,
  upsertUser,
  deleteUser,
  setUserPassword,
  getKpiMonthly,
  setKpiMonth,
  listBrands,
  addBrand,
  updateBrand,
  deleteBrand,
  listShopsMasked,
  addShop,
  updateShop,
  deleteShop,
} from './store'
import { aggregate, campaigns, creators, gmvOnly, ordersPage, recon, series, topProducts } from './views'
import { mergeAggregates } from '../src/domain/metrics'
import type { PlatformFilter } from '../src/data/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DASH_PORT ?? 8791)

const app = express()
app.use(express.json({ limit: '1mb' }))

const asPlatform = (v: unknown): PlatformFilter =>
  v === 'tiktok' || v === 'shopee' ? v : 'all'
interface Win { start: string; end: string }
const asWin = (v: unknown): Win => {
  const w = (v ?? {}) as Partial<Win>
  return { start: String(w.start ?? ''), end: String(w.end ?? '') }
}

app.get('/health', (_req, res) => res.json({ ok: true, port: PORT }))

// ---- auth (public) ----
app.get('/api/auth/me', (req, res) => {
  const id = getSessionUserId(req)
  const user = id !== null ? getUser(id) : undefined
  res.json({ user: user && user.active ? user : null })
})

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

app.post('/api/auth/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

// ---- everything below requires a session ----
app.use('/api/', requireAuth)

// ---- per-screen views (aggregated from SQLite) ----
app.post('/api/view/overview', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const platform = asPlatform(b.platform)
  const brand = String(b.brand ?? 'group')
  const cur = asWin(b.cur)
  const prev = asWin(b.prev)
  const seriesW = asWin(b.series)
  const daily = asWin(b.daily)
  const monthly = asWin(b.monthly)
  const quarterly = asWin(b.quarterly)
  const yearly = asWin(b.yearly)

  const tkAgg = aggregate('tiktok', brand, cur.start, cur.end)
  const spAgg = aggregate('shopee', brand, cur.start, cur.end)
  const curAgg =
    platform === 'all' ? mergeAggregates([tkAgg, spAgg]) : platform === 'tiktok' ? tkAgg : spAgg

  res.json({
    cur: curAgg,
    prev: aggregate(platform, brand, prev.start, prev.end),
    tkAgg,
    spAgg,
    series: series(platform, brand, seriesW.start, seriesW.end),
    campaigns: campaigns(platform, brand, cur.start, cur.end),
    topProducts: topProducts(platform, brand, cur.start, cur.end),
    kpiActuals: {
      daily: gmvOnly(platform, brand, daily.start, daily.end),
      monthly: gmvOnly(platform, brand, monthly.start, monthly.end),
      quarterly: gmvOnly(platform, brand, quarterly.start, quarterly.end),
      yearly: gmvOnly(platform, brand, yearly.start, yearly.end),
    },
  })
})

app.get('/api/view/ads', (req, res) => {
  const platform = asPlatform(req.query.platform)
  const brand = String(req.query.brand ?? 'group')
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  res.json({ campaigns: campaigns(platform, brand, start, end) })
})

app.get('/api/view/koc', (req, res) => {
  const platform = asPlatform(req.query.platform)
  const brand = String(req.query.brand ?? 'group')
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  res.json({ creators: creators(platform, brand, start, end), cur: aggregate(platform, brand, start, end) })
})

app.get('/api/view/recon', (req, res) => {
  const platform = asPlatform(req.query.platform)
  const brand = String(req.query.brand ?? 'group')
  res.json({ reconOrders: recon(platform, brand) })
})

app.post('/api/view/orders', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const platform = asPlatform(b.platform)
  const brand = String(b.brand ?? 'group')
  const status = b.status === 'settled' || b.status === 'pending' ? b.status : 'all'
  const sortKey = typeof b.sortKey === 'string' ? b.sortKey : ''
  const sortDir = b.sortDir === 'asc' ? 'asc' : 'desc'
  const pageSize = Math.min(Math.max(1, Number(b.pageSize) || 50), 100)
  const page = Math.max(0, Number(b.page) || 0)
  res.json(
    ordersPage(platform, brand, {
      status,
      q: typeof b.q === 'string' ? b.q : '',
      sortKey,
      sortDir,
      page,
      pageSize,
    }),
  )
})

app.post('/api/view/kpi-actuals', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const platform = asPlatform(b.platform)
  const brand = String(b.brand ?? 'group')
  const daily = asWin(b.daily)
  const monthly = asWin(b.monthly)
  const quarterly = asWin(b.quarterly)
  const yearly = asWin(b.yearly)
  res.json({
    kpiActuals: {
      daily: gmvOnly(platform, brand, daily.start, daily.end),
      monthly: gmvOnly(platform, brand, monthly.start, monthly.end),
      quarterly: gmvOnly(platform, brand, quarterly.start, quarterly.end),
      yearly: gmvOnly(platform, brand, yearly.start, yearly.end),
    },
  })
})

// ---- config CRUD (writes to the shared DB — still no external calls) ----
app.get('/api/costs/cogs', (_req, res) => res.json(listCogs()))
app.put('/api/costs/cogs', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const sku = String(b.sku ?? '')
  const unitCost = Number(b.unitCost)
  if (!sku || !Number.isFinite(unitCost) || unitCost < 0) {
    res.status(400).json({ error: 'sku + unitCost (>=0) required' })
    return
  }
  res.json(
    upsertCogs({
      sku,
      unitCost,
      name: typeof b.name === 'string' ? b.name : undefined,
      brand: typeof b.brand === 'string' ? b.brand : undefined,
      price: typeof b.price === 'number' ? b.price : undefined,
      effectiveDate: typeof b.effectiveDate === 'string' ? b.effectiveDate : undefined,
    }),
  )
})

app.get('/api/costs/bookings', (req, res) => {
  const platform = req.query.platform as 'tiktok' | 'shopee' | 'all' | undefined
  const brand = req.query.brand as string | undefined
  res.json(listBookings({ platform, brand }))
})
app.post('/api/costs/bookings', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  if (!b.creator || (b.platform !== 'tiktok' && b.platform !== 'shopee') || typeof b.fee !== 'number') {
    res.status(400).json({ error: 'creator, platform (tiktok|shopee), fee (number) required' })
    return
  }
  res.json(
    addBooking({
      creator: String(b.creator),
      campaign: typeof b.campaign === 'string' ? b.campaign : '',
      brand: typeof b.brand === 'string' ? b.brand : 'nonelab',
      platform: b.platform,
      fee: b.fee,
      date: typeof b.date === 'string' ? b.date : undefined,
      status: typeof b.status === 'string' ? b.status : undefined,
    }),
  )
})
app.delete('/api/costs/bookings/:id', (req, res) => {
  const ok = deleteBooking(Number(req.params.id))
  res.status(ok ? 200 : 404).json({ ok })
})

app.get('/api/users', (_req, res) => res.json(listUsers()))
app.post('/api/users', (req, res) => {
  const u = (req.body ?? {}) as Record<string, unknown>
  if (!u.name || !u.email || (u.role !== 'ceo' && u.role !== 'bm' && u.role !== 'ops')) {
    res.status(400).json({ error: 'name, email, role (ceo|bm|ops) required' })
    return
  }
  res.json(
    addUser({
      name: String(u.name),
      email: String(u.email),
      role: u.role,
      platforms: Array.isArray(u.platforms) ? (u.platforms as never) : [],
      channels: Array.isArray(u.channels) ? (u.channels as never) : [],
      active: typeof u.active === 'boolean' ? u.active : undefined,
    }),
  )
})
app.put('/api/users/:id', (req, res) => {
  const u = (req.body ?? {}) as Record<string, unknown>
  const updated = upsertUser(Number(req.params.id), {
    name: typeof u.name === 'string' ? u.name : undefined,
    email: typeof u.email === 'string' ? u.email : undefined,
    role: u.role as never,
    platforms: Array.isArray(u.platforms) ? (u.platforms as never) : undefined,
    channels: Array.isArray(u.channels) ? (u.channels as never) : undefined,
    active: typeof u.active === 'boolean' ? u.active : undefined,
  })
  if (!updated) {
    res.status(404).json({ error: 'user not found' })
    return
  }
  res.json(updated)
})
app.delete('/api/users/:id', (req, res) => {
  const ok = deleteUser(Number(req.params.id))
  res.status(ok ? 200 : 404).json({ ok })
})
app.put('/api/users/:id/password', (req, res) => {
  const password = ((req.body ?? {}) as Record<string, unknown>).password
  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters' })
    return
  }
  const ok = setUserPassword(Number(req.params.id), password)
  if (!ok) {
    res.status(404).json({ error: 'user not found' })
    return
  }
  res.json({ ok: true, hasPassword: true })
})

app.get('/api/kpi-monthly', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear()
  const brand = String(req.query.brand ?? 'group')
  res.json(getKpiMonthly(year, brand))
})
app.put('/api/kpi-monthly', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
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
  res.json(setKpiMonth(year, month, brand, target))
})

app.get('/api/brands', (_req, res) => res.json(listBrands()))
app.post('/api/brands', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name.trim()) {
    res.status(400).json({ error: 'name required' })
    return
  }
  try {
    res.json(addBrand({ key: typeof b.key === 'string' ? b.key : undefined, name: b.name.trim() }))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})
app.put('/api/brands/:id', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const updated = updateBrand(Number(req.params.id), {
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
    const ok = deleteBrand(Number(req.params.id))
    res.status(ok ? 200 : 404).json({ ok })
  } catch (err) {
    res.status(409).json({ error: (err as Error).message })
  }
})

app.get('/api/shops', (req, res) => {
  const brand = req.query.brand as string | undefined
  const platform = req.query.platform as 'tiktok' | 'shopee' | undefined
  res.json(listShopsMasked({ brandKey: brand, platform }))
})
app.post('/api/shops', (req, res) => {
  const s = (req.body ?? {}) as Record<string, unknown>
  if (!s.brandKey || (s.platform !== 'tiktok' && s.platform !== 'shopee') || !s.name) {
    res.status(400).json({ error: 'brandKey, platform (tiktok|shopee), name required' })
    return
  }
  if (s.mode && s.mode !== 'sample' && s.mode !== 'live') {
    res.status(400).json({ error: 'mode must be sample|live' })
    return
  }
  if (!listBrands().some((br) => br.key === s.brandKey)) {
    res.status(400).json({ error: `brand '${String(s.brandKey)}' không tồn tại` })
    return
  }
  res.json(
    addShop({
      brandKey: String(s.brandKey),
      platform: s.platform,
      name: String(s.name),
      mode: s.mode as never,
      active: typeof s.active === 'boolean' ? s.active : undefined,
      credentials: s.credentials as never,
    }),
  )
})
app.put('/api/shops/:id', (req, res) => {
  const s = (req.body ?? {}) as Record<string, unknown>
  if (s.mode && s.mode !== 'sample' && s.mode !== 'live') {
    res.status(400).json({ error: 'mode must be sample|live' })
    return
  }
  const updated = updateShop(Number(req.params.id), {
    name: typeof s.name === 'string' ? s.name : undefined,
    mode: s.mode as never,
    active: typeof s.active === 'boolean' ? s.active : undefined,
    credentials: s.credentials && typeof s.credentials === 'object' ? (s.credentials as never) : undefined,
  })
  if (!updated) {
    res.status(404).json({ error: 'shop not found' })
    return
  }
  res.json(updated)
})
app.delete('/api/shops/:id', (req, res) => {
  const ok = deleteShop(Number(req.params.id))
  res.status(ok ? 200 : 404).json({ ok })
})

// ---- static (prod): serve the built SPA from the same origin ----
const DIST = path.join(__dirname, '..', 'dist')
if (existsSync(DIST)) {
  app.use(express.static(DIST))
  // SPA fallback (Express 5 dropped the '*' route string — use a plain middleware).
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`[dashboard-api] listening on :${PORT} (read-only metrics from SQLite, no external calls)`)
})
