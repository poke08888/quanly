// Revenue-chart granularity: the M1 line chart adapts its buckets to the selected
// period — a single day → by HOUR (synthesized intraday curve, no hourly source
// data), a week → by DAY, a month → by WEEK, a quarter → by MONTH.
import type { DailyRow, Period } from '../data/types'

export interface ChartPoint {
  label: string
  gmv: number
  cost: number
  profit: number
}

export type Granularity = 'hour' | 'day' | 'week' | 'month'

/** Total cost of a day = COGS + ads + KOC + all 6 platform fees. */
export function rowCost(r: DailyRow): number {
  const f = r.fees
  return (
    r.cogs + r.ads + r.kocBooking +
    f.commission_fee + f.payment_fee + f.service_fee +
    f.seller_voucher + f.shipping_borne + f.affiliate_comm
  )
}

export function granularityFor(period: Period): Granularity {
  const span = period.cur[0] - period.cur[1] // days covered by the period
  if (span <= 0) return 'hour'
  if (span <= 8) return 'day'
  if (span <= 40) return 'week'
  return 'month'
}

const GRAN_NOTE: Record<Granularity, string> = {
  hour: 'theo giờ',
  day: 'theo ngày',
  week: 'theo tuần',
  month: 'theo tháng',
}

// Deterministic intraday shopping curve (24h): quiet at night, midday bump, evening peak.
const HOUR_WEIGHTS = [
  2, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 7, 9, 11, 12, 10, 7, 5, 3,
]

const ddmm = (isoDate: string) => isoDate.slice(8, 10) + '/' + isoDate.slice(5, 7)

/** Real intraday point (hour deltas from the poller's cumulative snapshots). */
export interface HourlyPoint {
  hour: number
  gmv: number
  cost: number
  profit: number
}

export function buildChart(
  rows: DailyRow[],
  period: Period,
  hourly?: HourlyPoint[],
): { points: ChartPoint[]; note: string } {
  const [startOff, endOff] = period.cur
  const gran = granularityFor(period)

  // REAL hourly data available (poller snapshots) → use it, no synthetic curve.
  if (gran === 'hour' && hourly && hourly.length > 0) {
    return {
      points: hourly.map((h) => ({ label: `${h.hour}h`, gmv: h.gmv, cost: h.cost, profit: h.profit })),
      note: `${period.label || 'Kỳ đang chọn'} — theo giờ (dữ liệu thật)`,
    }
  }
  // period rows, oldest → newest (off high → low)
  const inRange = rows
    .filter((r) => r.off <= startOff && r.off >= endOff)
    .sort((a, b) => b.off - a.off)

  let points: ChartPoint[]

  if (gran === 'hour') {
    // There is NO hourly source data (daily_data is per-day): the curve is an ESTIMATED
    // intraday distribution of the day's real total. For TODAY, only draw hours that
    // have already happened (0h..now) — never fabricate future hours — and renormalize
    // the weights over that slice so the drawn hours still sum to the real total-so-far.
    const day = inRange.find((r) => r.off === endOff) ?? inRange[inRange.length - 1] ?? rows[rows.length - 1]
    const isToday = endOff === 0
    const lastHour = isToday ? new Date().getHours() : 23
    const weights = HOUR_WEIGHTS.slice(0, lastHour + 1)
    const sumW = weights.reduce((a, b) => a + b, 0) || 1
    points = weights.map((w, h) => {
      const f = w / sumW
      return {
        label: `${h}h`,
        gmv: day ? day.gmv * f : 0,
        cost: day ? rowCost(day) * f : 0,
        profit: day ? day.profit * f : 0,
      }
    })
    const cutNote = isToday ? ` đến ${lastHour}h,` : ''
    return {
      points,
      note: `${period.label || 'Kỳ đang chọn'} — theo giờ (${cutNote} phân bổ ước tính — chưa có dữ liệu giờ thật)`.replace('( ', '('),
    }
  } else if (gran === 'day') {
    points = inRange.map((r) => ({ label: ddmm(r.date), gmv: r.gmv, cost: rowCost(r), profit: r.profit }))
  } else if (gran === 'week') {
    points = bucketBy(inRange, (r) => Math.floor((r.off - endOff) / 7), (b) => 'T. ' + ddmm(b[0].date))
  } else {
    points = bucketBy(inRange, (r) => r.date.slice(0, 7), (b) => 'Th ' + Number(b[0].date.slice(5, 7)))
  }

  return { points, note: (period.label || 'Kỳ đang chọn') + ' — ' + GRAN_NOTE[gran] }
}

/** Group ascending-ordered rows into contiguous buckets, summing metrics. */
function bucketBy(
  rows: DailyRow[],
  keyOf: (r: DailyRow) => number | string,
  labelOf: (bucketRows: DailyRow[]) => string,
): ChartPoint[] {
  const order: (number | string)[] = []
  const map = new Map<number | string, DailyRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    if (!map.has(k)) {
      map.set(k, [])
      order.push(k)
    }
    map.get(k)!.push(r)
  }
  return order.map((k) => {
    const b = map.get(k)!
    return {
      label: labelOf(b),
      gmv: b.reduce((a, r) => a + r.gmv, 0),
      cost: b.reduce((a, r) => a + rowCost(r), 0),
      profit: b.reduce((a, r) => a + r.profit, 0),
    }
  })
}
