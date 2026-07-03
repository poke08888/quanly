// VND + number formatting — ported from data.js. Vietnamese conventions:
// comma as decimal separator, "tỷ"/"tr"/"K" scale suffixes.

function trimNum(x: number): string {
  const s = x >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString()
  return s.replace('.', ',')
}

export function fmtVND(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1e9) return sign + trimNum(abs / 1e9) + ' tỷ'
  if (abs >= 1e6) return sign + trimNum(abs / 1e6) + ' tr'
  if (abs >= 1e3) return sign + Math.round(abs / 1e3) + 'K'
  return sign + Math.round(abs) + ' đ'
}

export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('vi-VN')
}

export function fmtPct(v: number, dp?: number): string {
  return (v * 100).toFixed(dp == null ? 1 : dp).replace('.', ',') + '%'
}

export function fmtX(v: number): string {
  return v.toFixed(1).replace('.', ',') + 'x'
}

/** Full-number toggle equivalent of the prototype's `fmt` when fullNumbers is on. */
export function fmtFull(v: number): string {
  return Math.round(v).toLocaleString('vi-VN') + ' đ'
}

/** DD/MM from an ISO yyyy-mm-dd string. */
export function fmtDayMonth(iso: string): string {
  return iso.slice(8, 10) + '/' + iso.slice(5, 7)
}
