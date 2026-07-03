// Realtime period model. Unlike the old prototype (anchored to a frozen 2026-07-02),
// "today" here is the REAL current day: offset 0 = hôm nay thật, and the elapsed
// windows for "Tháng này"/"Quý này" are computed from the real calendar date.

import type { Period } from '../data/types'

const DAY_MS = 86_400_000

/** Real "today" at local midnight. Recomputed each call so a long-open tab rolls over. */
export function todayStart(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** A render-time snapshot of today (fine for labels/highlighting). Fetch paths use todayStart(). */
export const TODAY: Date = todayStart()

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** ISO 'YYYY-MM-DD' for the date `off` days before the anchor (default real today). */
export function isoOffset(off: number, anchor: Date = todayStart()): string {
  return iso(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - off))
}

/** Days-ago offset (relative to the anchor) for an ISO date string. */
export function offsetOfIso(dateStr: string, anchor: Date = todayStart()): number {
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((anchor.getTime() - d.getTime()) / DAY_MS)
}

/** Elapsed days from the start of the quarter containing `today`, inclusive. */
function elapsedInQuarter(today: Date): number {
  const qStartMonth = Math.floor(today.getMonth() / 3) * 3
  const qStart = new Date(today.getFullYear(), qStartMonth, 1)
  return Math.round((today.getTime() - qStart.getTime()) / DAY_MS) + 1
}

/** Previous window of equal length immediately preceding a cur window ending at offset 0. */
function prevOf(startOff: number): [number, number] {
  return [2 * startOff + 1, startOff + 1]
}

/** Build the period presets for a given real "today" (mtd/quarter windows are dynamic). */
export function buildPeriods(today: Date = todayStart()): Period[] {
  const mtdStart = today.getDate() - 1 // offset of this month's 1st day
  const qStart = elapsedInQuarter(today) - 1 // offset of this quarter's 1st day
  const qNum = Math.floor(today.getMonth() / 3) + 1
  return [
    { id: 'today', label: 'Hôm nay', cur: [0, 0], prev: [1, 1] },
    { id: 'yesterday', label: 'Hôm qua', cur: [1, 1], prev: [2, 2] },
    { id: '7d', label: '7 ngày', cur: [6, 0], prev: [13, 7] },
    { id: '30d', label: '30 ngày', cur: [29, 0], prev: [59, 30] },
    { id: 'mtd', label: 'Tháng này', cur: [mtdStart, 0], prev: prevOf(mtdStart) },
    { id: 'quarter', label: `Quý ${qNum}`, cur: [qStart, 0], prev: prevOf(qStart) },
    { id: '90d', label: '90 ngày', cur: [89, 0], prev: [179, 90] },
  ]
}

/** Default presets anchored to the real current day (snapshot at module load). */
export const PERIODS: Period[] = buildPeriods(TODAY)
