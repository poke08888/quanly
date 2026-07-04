// Central dashboard state: session/login + filters + role + local edits, and per-screen
// data fetched from the read-API (each screen = ONE consolidated request the server
// aggregates from SQLite). Realtime "today": offsets convert to the real current date.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { upsertCogs, addBooking as addBookingStore, fetchCatalog, fetchBookings } from '../data/costStore'
import {
  fetchUsers,
  upsertUser as upsertUserStore,
  addUser as addUserStore,
  deleteUser as deleteUserStore,
  setUserPassword as setUserPasswordStore,
  type User,
} from '../data/userStore'
import { fetchKpiMonthly, saveKpiMonth as saveKpiMonthStore, type KpiMonthly } from '../data/kpiStore'
import {
  fetchBrands,
  fetchShops,
  addBrand as addBrandStore,
  updateBrand as updateBrandStore,
  deleteBrand as deleteBrandStore,
  addShop as addShopStore,
  updateShop as updateShopStore,
  deleteShop as deleteShopStore,
  type BrandConfig,
  type ShopConfig,
} from '../data/brandShopStore'
import { fetchMe, login as loginApi, logout as logoutApi, type AuthUser } from '../data/authApi'
import { ApiAuthError } from '../data/apiBase'
import { fetchOverview, fetchAds, fetchKoc, fetchRecon, fetchKpiActuals, type Win, type HourPoint } from '../data/viewApi'
import { periodSpan, type KpiPeriod } from '../lib/kpiProgress'
import { buildPeriods, isoOffset, offsetOfIso, todayStart } from '../lib/period'
import { emptyAggregate } from '../domain/metrics'
import type {
  Aggregate,
  Booking,
  Campaign,
  Creator,
  DailyRow,
  Period,
  PlatformFilter,
  Product,
  ProductPerf,
  ReconOrder,
} from '../data/types'
import { CONFIG, ROLE_NAV, type Role, type ScreenId } from './roles'
import { fmtFull, fmtVND } from '../lib/format'

export interface DashboardData {
  cur: Aggregate
  prev: Aggregate
  tkAgg: Aggregate
  spAgg: Aggregate
  series: DailyRow[]
  /** Real intraday points (single-day periods only; [] = fall back to estimate). */
  hourly: HourPoint[]
  campaigns: Campaign[]
  creators: Creator[]
  topProducts: ProductPerf[]
  reconOrders: ReconOrder[]
  catalog: Product[]
  bookings: Booking[]
  users: User[]
  kpiMonthly: KpiMonthly
  kpiActuals: Record<KpiPeriod, number>
}

const ZERO_ACTUALS: Record<KpiPeriod, number> = { daily: 0, monthly: 0, quarterly: 0, yearly: 0 }

/** DashboardData with safe empties; each screen fills only the fields it renders. */
function emptyData(kpiYear: number): DashboardData {
  return {
    cur: emptyAggregate(),
    prev: emptyAggregate(),
    tkAgg: emptyAggregate(),
    spAgg: emptyAggregate(),
    series: [],
    hourly: [],
    campaigns: [],
    creators: [],
    topProducts: [],
    reconOrders: [],
    catalog: [],
    bookings: [],
    users: [],
    kpiMonthly: { year: kpiYear, brand: 'group', months: Array(12).fill(0) },
    kpiActuals: ZERO_ACTUALS,
  }
}

/** Window [startOff, endOff] (days-ago) → concrete ISO dates anchored at real today. */
function win(startOff: number, endOff: number): Win {
  return { start: isoOffset(startOff), end: isoOffset(endOff) }
}

export function useDashboard() {
  // ----- auth / session -----
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchMe().then((u) => {
      if (cancelled) return
      setAuthUser(u)
      setAuthReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ----- filters / role -----
  const [role, setRole] = useState<Role>(CONFIG.defaultRole)
  const [screen, setScreen] = useState<ScreenId>('m1')
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [brand, setBrand] = useState<string>('group')
  const [periodId, setPeriodId] = useState<string>('today')
  const [compare, setCompare] = useState(true)
  const [kpiYear, setKpiYear] = useState<number>(todayStart().getFullYear())
  const [customStart, setCustomStart] = useState<string>(isoOffset(6))
  const [customEnd, setCustomEnd] = useState<string>(isoOffset(0))

  // ----- local UI / reload -----
  const [importDone, setImportDone] = useState(false)
  const [reload, setReload] = useState(0)
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [reconFilter, setReconFilter] = useState<'all' | 'settled' | 'pending'>('all')

  const canEdit = role === 'ops'
  const allowed = ROLE_NAV[role]
  const effScreen: ScreenId = allowed.includes(screen) ? screen : allowed[0]

  // Realtime period presets (recomputed on reload so a long-open tab rolls the day).
  const periods = useMemo<Period[]>(() => buildPeriods(todayStart()), [reload])

  const period: Period = useMemo(() => {
    if (periodId === 'custom') {
      let s = Math.max(offsetOfIso(customStart), 0)
      let e = Math.max(offsetOfIso(customEnd), 0)
      if (e > s) [s, e] = [e, s]
      const len = s - e + 1
      return { id: 'custom', label: 'Tùy chỉnh', cur: [s, e], prev: [s + len, e + len] }
    }
    return periods.find((p) => p.id === periodId) || periods[0]
  }, [periodId, customStart, customEnd, periods])

  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ----- brands + shops config (header dropdown + M10) -----
  const [brands, setBrands] = useState<BrandConfig[]>([])
  const [shops, setShops] = useState<ShopConfig[]>([])
  useEffect(() => {
    if (!authUser) return
    let cancelled = false
    Promise.all([fetchBrands(), fetchShops()])
      .then(([bs, ss]) => {
        if (cancelled) return
        setBrands(bs)
        setShops(ss)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [reload, authUser])

  // ----- per-screen data fetch -----
  useEffect(() => {
    if (!authUser) return
    let cancelled = false
    setError(null)
    setData(null)

    const curW = win(period.cur[0], period.cur[1])
    const prevW = win(period.prev[0], period.prev[1])
    const chartStart = Math.max(period.cur[0], 13)
    const seriesW = win(chartStart, 0)
    const today = todayStart()
    const mSpan = periodSpan('monthly', today)
    const qSpan = periodSpan('quarterly', today)
    const ySpan = periodSpan('yearly', today)
    const dailyW = win(0, 0)
    const monthlyW = win(mSpan.startOff, mSpan.endOff)
    const quarterlyW = win(qSpan.startOff, qSpan.endOff)
    const yearlyW = win(ySpan.startOff, ySpan.endOff)

    const run = async (): Promise<DashboardData> => {
      const base = emptyData(kpiYear)
      switch (effScreen) {
        case 'm1': {
          const [ov, kpiMonthly] = await Promise.all([
            fetchOverview({
              platform,
              brand,
              cur: curW,
              prev: prevW,
              series: seriesW,
              daily: dailyW,
              monthly: monthlyW,
              quarterly: quarterlyW,
              yearly: yearlyW,
            }),
            fetchKpiMonthly(kpiYear, brand),
          ])
          return { ...base, ...ov, kpiMonthly }
        }
        case 'm3': {
          const { campaigns } = await fetchAds(platform, brand, curW)
          return { ...base, campaigns }
        }
        case 'm4': {
          const { creators, cur } = await fetchKoc(platform, brand, curW)
          return { ...base, creators, cur }
        }
        case 'm5': {
          const [catalog, bookings] = await Promise.all([fetchCatalog(), fetchBookings(platform, brand)])
          return { ...base, catalog, bookings }
        }
        case 'm6': {
          const { reconOrders } = await fetchRecon(platform, brand)
          return { ...base, reconOrders }
        }
        // m7 (Đơn hàng) self-fetches paginated orders — no bulk recon load here.
        case 'm8': {
          const users = await fetchUsers()
          return { ...base, users }
        }
        case 'm9': {
          const [kpiMonthly, actuals] = await Promise.all([
            fetchKpiMonthly(kpiYear, brand),
            fetchKpiActuals({ platform, brand, daily: dailyW, monthly: monthlyW, quarterly: quarterlyW, yearly: yearlyW }),
          ])
          return { ...base, kpiMonthly, kpiActuals: actuals.kpiActuals }
        }
        default:
          return base // m10 uses brands/shops (loaded separately)
      }
    }

    run()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiAuthError) {
          setAuthUser(null)
          return
        }
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [authUser, effScreen, platform, brand, period, reload, kpiYear])

  const fmt = (v: number) => (CONFIG.fullNumbers ? fmtFull(v) : fmtVND(v))
  const bump = useCallback(() => setReload((n) => n + 1), [])

  // ----- auth actions -----
  async function login(email: string, password: string) {
    const u = await loginApi(email, password)
    setAuthUser(u)
    setReload((n) => n + 1)
  }
  async function logout() {
    await logoutApi()
    setAuthUser(null)
    setData(null)
  }

  // ----- M5 -----
  async function saveCogs(sku: string, cost: number) {
    await upsertCogs(sku, cost)
    bump()
  }
  async function addBooking(input: { creator: string; campaign: string; platform: 'tiktok' | 'shopee'; fee: number }) {
    await addBookingStore({
      creator: input.creator,
      campaign: input.campaign || '—',
      platform: input.platform,
      brand: brand === 'group' ? 'nonelab' : brand,
      fee: input.fee,
    })
    bump()
  }

  // ----- M8 -----
  async function saveUser(id: number, patch: Partial<Omit<User, 'id'>>) {
    await upsertUserStore(id, patch)
    bump()
  }
  async function addUser(input: { name: string; email: string; role: User['role'] }) {
    await addUserStore({ ...input, platforms: [], channels: [], active: true })
    bump()
  }
  async function removeUser(id: number) {
    await deleteUserStore(id)
    bump()
  }
  async function setUserPassword(id: number, password: string) {
    await setUserPasswordStore(id, password)
    bump()
  }

  // ----- M9 -----
  async function saveKpiMonth(year: number, month: number, target: number) {
    await saveKpiMonthStore(year, month, brand, target)
    bump()
  }

  // ----- M10 -----
  async function addBrand(input: { name: string; key?: string }) {
    await addBrandStore(input)
    bump()
  }
  async function saveBrand(id: number, patch: { name?: string; active?: boolean }) {
    await updateBrandStore(id, patch)
    bump()
  }
  async function removeBrand(id: number) {
    await deleteBrandStore(id)
    bump()
  }
  async function addShop(input: Parameters<typeof addShopStore>[0]) {
    await addShopStore(input)
    bump()
  }
  async function saveShop(id: number, patch: Parameters<typeof updateShopStore>[1]) {
    await updateShopStore(id, patch)
    bump()
  }
  async function removeShop(id: number) {
    await deleteShopStore(id)
    bump()
  }

  return {
    // auth
    authUser,
    authReady,
    login,
    logout,
    // filters
    role,
    setRole,
    screen: effScreen,
    setScreen,
    allowed,
    platform,
    setPlatform,
    brand,
    setBrand,
    brandOptions: [
      { id: 'group', name: 'Toàn group' },
      ...brands.filter((b) => b.active).map((b) => ({ id: b.key, name: b.name })),
    ],
    periodId,
    setPeriodId,
    periods,
    period,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    compare,
    toggleCompare: () => setCompare((c) => !c),
    canEdit,
    alertMarginPct: CONFIG.alertMarginPct,
    // data
    data,
    error,
    fmt,
    // M5
    saveCogs,
    addBooking,
    importDone,
    setImportDone,
    // M8
    saveUser,
    addUser,
    removeUser,
    setUserPassword,
    // M9
    saveKpiMonth,
    kpiYear,
    setKpiYear,
    canEditKpi: role === 'bm' || role === 'ceo',
    // M10
    brands,
    shops,
    addBrand,
    saveBrand,
    removeBrand,
    addShop,
    saveShop,
    removeShop,
    reloadData: bump,
    // M6
    expandedOrder,
    setExpandedOrder,
    reconFilter,
    setReconFilter,
  }
}

export type DashboardState = ReturnType<typeof useDashboard>
