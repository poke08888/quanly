// M7 "Tất cả đơn hàng" — server-paginated. The browser fetches ONE page (~50 orders)
// from /api/view/orders; the API filters/sorts/paginates over recon in SQLite. No more
// pulling ~27k orders (~10MB) client-side. Design/markup kept identical to the old screen.
import { useEffect, useRef, useState } from 'react'
import type { DashboardState } from '../state/useDashboard'
import { StatCard } from '../components/ui/KpiCard'
import { PlatformBadge } from '../components/ui/PlatformBadge'
import { fmtDayMonth, fmtInt } from '../lib/format'
import { FEE_KEYS } from '../data/types'
import type { ReconOrder } from '../data/types'
import { FEE_LABELS } from '../lib/tokens'
import { SortHeader } from '../components/ui/SortHeader'
import { fetchOrders, type OrdersPage } from '../data/viewApi'
import type { SortDir } from '../lib/useSort'

const feeTotal = (r: ReconOrder) => FEE_KEYS.reduce((a, k) => a + r.fees[k], 0)

const PAGE_SIZE = 50
const STATUS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'settled', label: 'Đã đối soát' },
  { id: 'pending', label: 'Tạm tính' },
] as const

const EMPTY: OrdersPage = { rows: [], total: 0, totals: { gmv: 0, fee: 0, net: 0 } }

export function OrdersM7({ s }: { s: DashboardState }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [status, setStatus] = useState<'all' | 'settled' | 'pending'>('all')
  const [query, setQuery] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [sortKey, setSortKey] = useState<string>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<OrdersPage>(EMPTY)
  const [loading, setLoading] = useState(true)

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(query), 250)
    return () => clearTimeout(t)
  }, [query])

  // Fetch one page. When any FILTER changes, snap back to page 0 first (then fetch).
  const lastKey = useRef('')
  useEffect(() => {
    const key = [s.platform, s.brand, status, qDebounced, sortKey, sortDir].join('|')
    if (key !== lastKey.current) {
      lastKey.current = key
      if (page !== 0) {
        setPage(0)
        return
      }
    }
    let cancelled = false
    setLoading(true)
    fetchOrders({ platform: s.platform, brand: s.brand, status, q: qDebounced, sortKey, sortDir, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(EMPTY)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [s.platform, s.brand, status, qDebounced, sortKey, sortDir, page])

  // Click cycles desc → asc → cleared (server then returns the merged/date-desc order).
  const toggle = (key: string) => {
    setExpandedId(null)
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortDir('asc')
    } else {
      setSortKey('')
      setSortDir('desc')
    }
  }

  const fmt = s.fmt
  const rows = data.rows
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const pfLabel = s.platform === 'all' ? 'TikTok Shop + Shopee' : s.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee'

  return (
    <div className="nl-fade">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Số đơn hiển thị" value={fmtInt(data.total)} sub={pfLabel} />
        <StatCard label="Tổng GMV" value={fmt(data.totals.gmv)} sub="theo đơn đang lọc" />
        <StatCard label="Tổng phí" value={fmt(data.totals.fee)} sub="phí sàn + TT + DV + ..." valColor="#b3261e" />
        <StatCard label="Tổng thực nhận" value={fmt(data.totals.net)} sub="sau phí" valColor="#0f9d6b" />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, overflow: 'auto hidden' }}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Đơn hàng đa sàn</div>
            <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>Bấm vào một đơn để xem cấu trúc phí (9 trường chuẩn hoá)</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm mã đơn / sản phẩm…"
              style={{ border: '1px solid #d9dce4', borderRadius: 9, padding: '7px 11px', fontSize: 12.5, outline: 'none', minWidth: 200 }}
            />
            <div style={{ display: 'flex', gap: 3, background: '#e7e9ef', borderRadius: 9, padding: 3 }}>
              {STATUS.map((f) => {
                const active = status === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setStatus(f.id)}
                    style={{
                      border: 'none',
                      cursor: 'pointer',
                      padding: '5px 11px',
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: active ? '#fff' : 'transparent',
                      color: active ? '#191c22' : '#6b7180',
                      boxShadow: active ? '0 1px 3px rgba(20,22,30,0.12)' : 'none',
                    }}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="nl-trow" style={{ ...grid, ...headRow }}>
          <SortHeader label="Mã đơn" active={sortKey === 'id'} dir={sortDir} onClick={() => toggle('id')} />
          <SortHeader label="Sàn" active={sortKey === 'platform'} dir={sortDir} onClick={() => toggle('platform')} />
          <SortHeader label="Ngày" active={sortKey === 'date'} dir={sortDir} onClick={() => toggle('date')} />
          <SortHeader label="Sản phẩm" active={sortKey === 'product'} dir={sortDir} onClick={() => toggle('product')} />
          <SortHeader label="SL" align="right" active={sortKey === 'qty'} dir={sortDir} onClick={() => toggle('qty')} />
          <SortHeader label="GMV" align="right" active={sortKey === 'gmv'} dir={sortDir} onClick={() => toggle('gmv')} />
          <SortHeader label="Tổng phí" align="right" active={sortKey === 'fee'} dir={sortDir} onClick={() => toggle('fee')} />
          <SortHeader label="Thực nhận" align="right" active={sortKey === 'net'} dir={sortDir} onClick={() => toggle('net')} />
          <div>Trạng thái</div>
        </div>

        {rows.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: '#9aa0ac', fontSize: 12.5 }}>
            {loading ? 'Đang tải…' : 'Không có đơn khớp bộ lọc.'}
          </div>
        )}

        {rows.map((r) => {
          const total = feeTotal(r)
          const expanded = expandedId === r.id
          const stFg = r.isSettled ? '#0f6b4c' : '#8a5a12'
          const stBg = r.isSettled ? '#e3f5ec' : '#fdf3e0'
          return (
            <div key={r.id}>
              <div
                className="nl-trow"
                onClick={() => setExpandedId(expanded ? null : r.id)}
                style={{ ...grid, ...bodyRow, cursor: 'pointer', background: expanded ? '#f7f8fa' : '#fff' }}
              >
                <div
                  title={'#' + r.id}
                  style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {shortId(r.id)}
                </div>
                <div>
                  <PlatformBadge platform={r.platform} small />
                </div>
                <div style={{ color: '#6b7180', fontSize: 11.5 }}>{fmtDayMonth(r.date)}</div>
                <div
                  title={(r.items ?? [{ name: r.product, qty: r.qty }]).map((it) => `${it.name} ×${it.qty}`).join('\n')}
                  style={{ fontSize: 12, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product}</span>
                  {r.items && r.items.length > 1 && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#3d47d9',
                        background: '#eceefc',
                        borderRadius: 6,
                        padding: '2px 6px',
                      }}
                    >
                      +{r.items.length - 1}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.qty}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(r.gmv)}</div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#b3261e' }}>−{fmtInt(total)}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0f9d6b' }}>{fmtInt(r.net)}</div>
                <div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: stFg, background: stBg, borderRadius: 6, padding: '3px 8px' }}>
                    {r.isSettled ? 'Đã đối soát' : 'Tạm tính'}
                  </span>
                </div>
              </div>
              {expanded && (
                <div style={{ background: '#fafbfd', borderBottom: '1px solid #eef0f4', padding: '14px 20px 16px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7180', marginBottom: 3 }}>
                    Cấu trúc phí đơn #{r.id} — GMV {fmtInt(r.gmv)}đ → thực nhận {fmtInt(r.net)}đ
                  </div>
                  <div style={{ fontSize: 11, color: '#9aa0ac', marginBottom: 10 }}>
                    {(r.items ?? [{ name: r.product, qty: r.qty }])
                      .map((it) => `${it.name} ×${it.qty}`)
                      .join('  ·  ')}
                  </div>
                  <div className="nl-feegrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
                    {FEE_KEYS.map((k) => (
                      <div key={k} style={{ background: '#fff', border: '1px solid #e9ebf0', borderRadius: 9, padding: '9px 11px' }}>
                        <div style={{ fontSize: 11, color: '#6b7180' }}>{FEE_LABELS[k]}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, fontVariantNumeric: 'tabular-nums', color: r.fees[k] > 0 ? '#b3261e' : '#9aa0ac' }}>
                          {r.fees[k] > 0 ? '−' + fmtInt(r.fees[k]) : '0'}
                        </div>
                      </div>
                    ))}
                    <div style={{ background: '#eef7f1', border: '1px solid #cbe7d7', borderRadius: 9, padding: '9px 11px' }}>
                      <div style={{ fontSize: 11, color: '#0f6b4c' }}>Thực nhận (NET)</div>
                      <div style={{ fontSize: 13, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums', color: '#0f9d6b' }}>{fmtInt(r.net)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {data.total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', borderTop: '1px solid #eef0f4' }}>
            <div style={{ fontSize: 11.5, color: '#9aa0ac' }}>
              Trang {page + 1}/{totalPages} · {fmtInt(data.total)} đơn
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0} style={pageBtn(page <= 0)}>
                ‹ Trước
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pageBtn(page >= totalPages - 1)}>
                Sau ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Mã TikTok dài 18-19 số tràn cột 105px → hiện phần đuôi (phần phân biệt đơn);
 *  mã đầy đủ vẫn có ở tooltip + hàng bung. */
const shortId = (id: string): string => (id.length > 11 ? '#…' + id.slice(-9) : '#' + id)

const pageBtn = (disabled: boolean): React.CSSProperties => ({
  border: '1px solid #d9dce4',
  borderRadius: 8,
  background: disabled ? '#f4f5f8' : '#fff',
  color: disabled ? '#c2c7d0' : '#3d47d9',
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  cursor: disabled ? 'default' : 'pointer',
})

const grid = {
  display: 'grid',
  gridTemplateColumns: '105px 78px 82px 1.5fr 45px 105px 110px 110px 100px',
  gap: 10,
} as const
const headRow = {
  padding: '8px 20px',
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9aa0ac',
  borderBottom: '1px solid #eef0f4',
} as const
const bodyRow = {
  padding: '10px 20px',
  fontSize: 12.5,
  alignItems: 'center',
  borderBottom: '1px solid #f4f5f8',
} as const
