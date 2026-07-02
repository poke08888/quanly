// Revenue KPI store client — 12 monthly targets per year (set by BM); day/week/
// quarter/year are DERIVED (see lib/kpiProgress.ts). Persisted in the BFF.

const BFF_URL =
  import.meta.env.VITE_TIKTOK_BFF_URL ?? import.meta.env.VITE_SHOPEE_BFF_URL ?? 'http://localhost:8790'

export interface KpiMonthly {
  year: number
  /** Brand id ('group' = element-wise sum across brands, read-only). */
  brand: string
  /** 12 monthly revenue targets (index 0 = Jan … 11 = Dec), VND. */
  months: number[]
}

/** Default per-brand per-month target used when the BFF is unreachable (matches seed). */
export const DEFAULT_MONTH_TARGET = 3_000_000_000

export function defaultKpiMonthly(year: number, brand: string): KpiMonthly {
  // For 'group' the seed sums 3 brands × the per-brand default.
  const per = brand === 'group' ? DEFAULT_MONTH_TARGET * 3 : DEFAULT_MONTH_TARGET
  return { year, brand, months: Array.from({ length: 12 }, () => per) }
}

export async function fetchKpiMonthly(year: number, brand: string): Promise<KpiMonthly> {
  // Resilient read: degrade to defaults if the BFF is down so the app load
  // (Promise.all in useDashboard) never hangs.
  try {
    const res = await fetch(`${BFF_URL}/api/kpi-monthly?year=${year}&brand=${encodeURIComponent(brand)}`)
    if (!res.ok) throw new Error(`kpi-store ${res.status}`)
    const data = (await res.json()) as KpiMonthly
    if (!Array.isArray(data.months) || data.months.length !== 12) return defaultKpiMonthly(year, brand)
    return data
  } catch {
    return defaultKpiMonthly(year, brand)
  }
}

/** Persist one month's target (1..12) for a specific brand ('group' rejected by BFF). */
export async function saveKpiMonth(
  year: number,
  month: number,
  brand: string,
  target: number,
): Promise<KpiMonthly> {
  const res = await fetch(`${BFF_URL}/api/kpi-monthly`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, month, brand, target }),
  })
  if (!res.ok) throw new Error(`kpi-store PUT ${res.status}`)
  return (await res.json()) as KpiMonthly
}
