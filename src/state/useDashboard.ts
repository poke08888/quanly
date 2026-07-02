// Central dashboard state: filters + role + M5 local edits, plus async-fetched data
// from the DataRepository. Re-fetches whenever the relevant filters change.

import { useEffect, useMemo, useState } from 'react'
import { repository } from '../data/DataRepository'
import { upsertCogs, addBooking as addBookingStore } from '../data/costStore'
import {
  fetchUsers,
  upsertUser as upsertUserStore,
  addUser as addUserStore,
  deleteUser as deleteUserStore,
  setUserPassword as setUserPasswordStore,
  type User,
} from '../data/userStore'
import {
  fetchKpiMonthly,
  saveKpiMonth as saveKpiMonthStore,
  type KpiMonthly,
} from '../data/kpiStore'
import { periodSpan, type KpiPeriod } from '../lib/kpiProgress'
import { PERIODS, BRANDS, TODAY } from '../data/connectors/mock/mockData'

const DAY_MS = 86400000
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
/** ISO 'YYYY-MM-DD' for the date `off` days before TODAY. */
function isoOffset(off: number): string {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - off)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Days-ago offset (relative to TODAY) for an ISO date string. */
function offsetOfIso(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((dayStart(TODAY).getTime() - d.getTime()) / DAY_MS)
}
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
  campaigns: Campaign[]
  creators: Creator[]
  topProducts: ProductPerf[]
  reconOrders: ReconOrder[]
  catalog: Product[]
  bookings: Booking[]
  users: User[]
  /** 12 monthly revenue targets for the KPI year (BM-set); other periods derived. */
  kpiMonthly: KpiMonthly
  /** Actual GMV to-date per KPI period (respects the global platform/brand filter). */
  kpiActuals: Record<KpiPeriod, number>
}

export function useDashboard() {
  // ----- filters / role -----
  const [role, setRole] = useState<Role>(CONFIG.defaultRole)
  const [screen, setScreen] = useState<ScreenId>('m1')
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [brand, setBrand] = useState<string>('group')
  const [periodId, setPeriodId] = useState<string>('today')
  const [compare, setCompare] = useState(true)
  // KPI setting year (M9 year selector); defaults to TODAY's year.
  const [kpiYear, setKpiYear] = useState<number>(TODAY.getFullYear())
  const [customStart, setCustomStart] = useState<string>(isoOffset(6))
  const [customEnd, setCustomEnd] = useState<string>(isoOffset(0))

  // ----- M5 persisted-edit state -----
  // COGS + bookings now persist in the BFF cost store; `reload` re-fetches after a
  // write so the P&L fold + tables reflect the saved values (survives page reload).
  const [importDone, setImportDone] = useState(false)
  const [reload, setReload] = useState(0)

  // ----- M6 UI state -----
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [reconFilter, setReconFilter] = useState<'all' | 'settled' | 'pending'>('all')

  const canEdit = role === 'ops'

  // role gating -> effective screen
  const allowed = ROLE_NAV[role]
  const effScreen: ScreenId = allowed.includes(screen) ? screen : allowed[0]

  const period: Period = useMemo(() => {
    if (periodId === 'custom') {
      let s = Math.max(offsetOfIso(customStart), 0)
      let e = Math.max(offsetOfIso(customEnd), 0)
      if (e > s) [s, e] = [e, s] // start = older (larger offset), end = newer (smaller)
      const len = s - e + 1
      return { id: 'custom', label: 'Tùy chỉnh', cur: [s, e], prev: [s + len, e + len] }
    }
    return PERIODS.find((p) => p.id === periodId) || PERIODS[0]
  }, [periodId, customStart, customEnd])

  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    const chartStart = Math.max(period.cur[0], 13)
    // KPI actuals per period (respect the global platform/brand filter). Each is
    // GMV over the elapsed-days window [startOff .. endOff] anchored to TODAY.
    const mSpan = periodSpan('monthly', TODAY)
    const qSpan = periodSpan('quarterly', TODAY)
    const ySpan = periodSpan('yearly', TODAY)
    Promise.all([
      repository.aggregatePeriod(platform, period, brand, 'cur'),
      repository.aggregatePeriod(platform, period, brand, 'prev'),
      repository.aggregatePlatform('tiktok', period.cur[0], period.cur[1], brand),
      repository.aggregatePlatform('shopee', period.cur[0], period.cur[1], brand),
      repository.series(platform, chartStart, 0, brand),
      repository.campaigns(platform, period.cur[0], period.cur[1], brand),
      repository.creators(platform, period.cur[0], period.cur[1], brand),
      repository.topProducts(platform, period.cur[0], period.cur[1], brand),
      repository.reconOrders(platform, brand),
      repository.productCatalog(),
      repository.bookings(platform, brand),
      fetchUsers(),
      fetchKpiMonthly(kpiYear, brand),
      repository.aggregate(platform, 0, 0, brand), // daily actual (today)
      repository.aggregate(platform, mSpan.startOff, mSpan.endOff, brand),
      repository.aggregate(platform, qSpan.startOff, qSpan.endOff, brand),
      repository.aggregate(platform, ySpan.startOff, ySpan.endOff, brand),
    ]).then(
      ([cur, prev, tkAgg, spAgg, series, campaigns, creators, topProducts, reconOrders, catalog, bookings, users, kpiMonthly, dAgg, mAgg, qAgg, yAgg]) => {
        if (cancelled) return
        setData({
          cur,
          prev,
          tkAgg,
          spAgg,
          series,
          campaigns,
          creators,
          topProducts,
          reconOrders,
          catalog,
          bookings,
          users,
          kpiMonthly,
          kpiActuals: {
            daily: dAgg.gmv,
            monthly: mAgg.gmv,
            quarterly: qAgg.gmv,
            yearly: yAgg.gmv,
          },
        })
      },
    ).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
  }, [platform, brand, period, reload, kpiYear])

  const fmt = (v: number) => (CONFIG.fullNumbers ? fmtFull(v) : fmtVND(v))

  /** Persist a COGS unit cost to the store, then re-fetch (P&L fold updates). */
  async function saveCogs(sku: string, cost: number) {
    await upsertCogs(sku, cost)
    setReload((n) => n + 1)
  }

  /** Persist a booking to the store, then re-fetch. */
  async function addBooking(input: {
    creator: string
    campaign: string
    platform: 'tiktok' | 'shopee'
    fee: number
  }) {
    await addBookingStore({
      creator: input.creator,
      campaign: input.campaign || '—',
      platform: input.platform,
      brand: brand === 'group' ? 'nonelab' : brand,
      fee: input.fee,
    })
    setReload((n) => n + 1)
  }

  // ----- M8 user management (persisted, CEO-only screen) -----
  async function saveUser(id: number, patch: Partial<Omit<User, 'id'>>) {
    await upsertUserStore(id, patch)
    setReload((n) => n + 1)
  }
  async function addUser(input: { name: string; email: string; role: User['role'] }) {
    // New users start with no view permissions; the CEO grants sàn/kênh explicitly.
    await addUserStore({ ...input, platforms: [], channels: [], active: true })
    setReload((n) => n + 1)
  }
  async function removeUser(id: number) {
    await deleteUserStore(id)
    setReload((n) => n + 1)
  }
  /** Set/reset a user's login password, then re-fetch so hasPassword refreshes. */
  async function setUserPassword(id: number, password: string) {
    await setUserPasswordStore(id, password)
    setReload((n) => n + 1)
  }

  // ----- M9 revenue KPI monthly targets (per brand; BM/CEO writable) -----
  // Uses the header brand filter; 'group' is derived-sum and rejected by the BFF.
  async function saveKpiMonth(year: number, month: number, target: number) {
    await saveKpiMonthStore(year, month, brand, target)
    setReload((n) => n + 1)
  }

  return {
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
    brandOptions: [{ id: 'group', name: 'Toàn group' }, ...BRANDS],
    periodId,
    setPeriodId,
    periods: PERIODS,
    period,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    compare,
    toggleCompare: () => setCompare((c) => !c),
    canEdit,
    // config
    alertMarginPct: CONFIG.alertMarginPct,
    // data
    data,
    error,
    fmt,
    // M5 (persisted via BFF cost store)
    saveCogs,
    addBooking,
    importDone,
    setImportDone,
    // M8 (persisted via BFF user store)
    saveUser,
    addUser,
    removeUser,
    setUserPassword,
    // M9 (persisted via BFF kpi store)
    saveKpiMonth,
    kpiYear,
    setKpiYear,
    canEditKpi: role === 'bm' || role === 'ceo',
    // M6
    expandedOrder,
    setExpandedOrder,
    reconFilter,
    setReconFilter,
  }
}

export type DashboardState = ReturnType<typeof useDashboard>
