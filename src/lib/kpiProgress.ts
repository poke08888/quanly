// Pure KPI period math + carryover rule. Given the anchor date (TODAY) and a
// target/actual, compute elapsed/total/remaining days, % achieved, base per-day
// target and the carryover-adjusted per-day target for the remaining days.
//
// TODO a real implementation would use the live calendar/clock and a proper
// day-count for the actual current date; here everything is anchored to TODAY
// (2026-07-02 in the mock data) for a deterministic prototype.

export type KpiPeriod = 'daily' | 'monthly' | 'quarterly' | 'yearly'

export interface PeriodSpan {
  /** Days elapsed within the period, up to and including TODAY. */
  elapsed: number
  /** Total days in the period. */
  total: number
  /** Days remaining after TODAY. */
  remaining: number
  /**
   * The day-offset window (days-ago, start >= end) covering elapsed days up to
   * TODAY, for `repository.aggregate(platform, startOff, endOff, brand)`.
   */
  startOff: number
  endOff: number
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

/** Days in the quarter that contains `monthIndex0` (0-based), for `year`. */
function daysInQuarter(year: number, monthIndex0: number): number {
  const qStartMonth = Math.floor(monthIndex0 / 3) * 3
  let n = 0
  for (let m = qStartMonth; m < qStartMonth + 3; m++) n += daysInMonth(year, m)
  return n
}

/** Day-of-year (1-based) for `date`. */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.round((date.getTime() - start.getTime()) / 86_400_000)
}

/** Elapsed days from quarter start to `date` inclusive. */
function elapsedInQuarter(date: Date): number {
  const qStartMonth = Math.floor(date.getMonth() / 3) * 3
  const qStart = new Date(date.getFullYear(), qStartMonth, 1)
  return Math.round((date.getTime() - qStart.getTime()) / 86_400_000) + 1
}

/** Compute the day span for a period type, anchored to `today`. */
export function periodSpan(period: KpiPeriod, today: Date): PeriodSpan {
  let elapsed: number
  let total: number
  if (period === 'daily') {
    elapsed = 1
    total = 1
  } else if (period === 'monthly') {
    total = daysInMonth(today.getFullYear(), today.getMonth())
    elapsed = today.getDate()
  } else if (period === 'quarterly') {
    total = daysInQuarter(today.getFullYear(), today.getMonth())
    elapsed = elapsedInQuarter(today)
  } else {
    // yearly
    total = 365 // TODO leap-year aware in a real impl
    elapsed = dayOfYear(today)
  }
  const remaining = Math.max(total - elapsed, 0)
  // Actual GMV is aggregated over offsets [elapsed-1 .. 0] (elapsed-1 days ago .. today).
  return { elapsed, total, remaining, startOff: elapsed - 1, endOff: 0 }
}

export interface KpiProgress {
  target: number
  actual: number
  /** actual / target (can exceed 1). */
  pct: number
  reached: boolean
  elapsed: number
  total: number
  remaining: number
  /** target / total — even pace per-day target. */
  baseDaily: number
  /** carryover: remainingTarget / remaining (or remainingTarget if remaining=0). */
  adjustedDaily: number
  /** max(target - actual, 0). */
  remainingTarget: number
  /** True when behind pace (adjustedDaily > baseDaily) and not yet reached. */
  behindPace: boolean
}

/**
 * Carryover rule: "nếu chưa đạt thì cộng dồn phần thiếu và chia đều cho các ngày
 * còn lại." remainingTarget = max(target - actual, 0);
 * adjustedDaily = remaining > 0 ? remainingTarget / remaining : remainingTarget.
 */
export function kpiProgress(target: number, actual: number, span: PeriodSpan): KpiProgress {
  const remainingTarget = Math.max(target - actual, 0)
  const adjustedDaily = span.remaining > 0 ? remainingTarget / span.remaining : remainingTarget
  const baseDaily = span.total > 0 ? target / span.total : target
  const reached = target > 0 && actual >= target
  return {
    target,
    actual,
    pct: target > 0 ? actual / target : 0,
    reached,
    elapsed: span.elapsed,
    total: span.total,
    remaining: span.remaining,
    baseDaily,
    adjustedDaily,
    remainingTarget,
    behindPace: !reached && adjustedDaily > baseDaily,
  }
}

/** Progress-bar color from the achieved percentage. */
export function paceColor(pct: number): string {
  return pct >= 1 ? '#0f9d6b' : pct >= 0.7 ? '#e8890c' : '#e5484d'
}

export interface DerivedTargets {
  daily: number
  weekly: number
  monthly: number
  quarterly: number
  yearly: number
}

/**
 * Derive day/week/month/quarter/year revenue targets from the 12 monthly targets,
 * anchored to `today`. The BM only sets monthly numbers.
 *   monthlyTarget   = months[m-1]   (m = today's month, 1-based)
 *   dailyTarget     = monthlyTarget / daysInMonth(year, m)
 *   weeklyTarget    = dailyTarget * 7
 *   quarterlyTarget = Σ of the 3 months in today's quarter
 *   yearlyTarget    = Σ of all 12 months
 * `months` uses the CURRENT calendar month index from `today`; the array is the
 * target-year's 12 months (see kpiStore). // TODO cross-year quarters not handled.
 */
export function deriveTargets(months: number[], today: Date): DerivedTargets {
  const m0 = today.getMonth() // 0-based
  const monthly = months[m0] ?? 0
  const dim = daysInMonth(today.getFullYear(), m0)
  const daily = dim > 0 ? monthly / dim : 0
  const qStart = Math.floor(m0 / 3) * 3
  const quarterly = months[qStart] + months[qStart + 1] + months[qStart + 2]
  const yearly = months.reduce((s, x) => s + x, 0)
  return { daily, weekly: daily * 7, monthly, quarterly, yearly }
}
