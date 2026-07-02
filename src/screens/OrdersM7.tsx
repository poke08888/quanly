import { useMemo, useState } from 'react'
import type { DashboardState } from '../state/useDashboard'
import { StatCard } from '../components/ui/KpiCard'
import { PlatformBadge } from '../components/ui/PlatformBadge'
import { fmtDayMonth, fmtInt } from '../lib/format'
import { FEE_KEYS } from '../data/types'
import type { ReconOrder } from '../data/types'
import { FEE_LABELS } from '../lib/tokens'
import { useSort } from '../lib/useSort'
import { SortHeader } from '../components/ui/SortHeader'

const feeTotal = (r: ReconOrder) => FEE_KEYS.reduce((a, k) => a + r.fees[k], 0)

function orderVal(r: ReconOrder, k: string): number | string {
  switch (k) {
    case 'id': return r.id
    case 'platform': return r.platform
    case 'date': return r.date
    case 'product': return r.product
    case 'qty': return r.qty
    case 'gmv': return r.gmv
    case 'fee': return feeTotal(r)
    case 'net': return r.net
    default: return 0
  }
}

const STATUS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'settled', label: 'Đã đối soát' },
  { id: 'pending', label: 'Tạm tính' },
] as const

export function OrdersM7({ s }: { s: DashboardState }) {
  const d = s.data
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [status, setStatus] = useState<'all' | 'settled' | 'pending'>('all')
  const [query, setQuery] = useState('')

  const all = d?.reconOrders ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((r) => {
      if (status !== 'all' && (status === 'settled') !== r.isSettled) return false
      if (q && !(`#${r.id}`.toLowerCase().includes(q) || r.product.toLowerCase().includes(q))) return false
      return true
    })
  }, [all, status, query])
  const { sorted, sort, toggle } = useSort<ReconOrder, string>(filtered, orderVal, { key: 'date', dir: 'desc' })

  if (!d) return null
  const fmt = s.fmt

  const totGmv = filtered.reduce((a, r) => a + r.gmv, 0)
  const totFee = filtered.reduce((a, r) => a + feeTotal(r), 0)
  const totNet = filtered.reduce((a, r) => a + r.net, 0)
  const pfLabel = s.platform === 'all' ? 'TikTok Shop + Shopee' : s.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee'

  return (
    <div className="nl-fade">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Số đơn hiển thị" value={fmtInt(filtered.length)} sub={pfLabel} />
        <StatCard label="Tổng GMV" value={fmt(totGmv)} sub="theo đơn đang lọc" />
        <StatCard label="Tổng phí" value={fmt(totFee)} sub="phí sàn + TT + DV + ..." valColor="#b3261e" />
        <StatCard label="Tổng thực nhận" value={fmt(totNet)} sub="sau phí" valColor="#0f9d6b" />
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
          <SortHeader label="Mã đơn" active={sort.key === 'id'} dir={sort.dir} onClick={() => toggle('id')} />
          <SortHeader label="Sàn" active={sort.key === 'platform'} dir={sort.dir} onClick={() => toggle('platform')} />
          <SortHeader label="Ngày" active={sort.key === 'date'} dir={sort.dir} onClick={() => toggle('date')} />
          <SortHeader label="Sản phẩm" active={sort.key === 'product'} dir={sort.dir} onClick={() => toggle('product')} />
          <SortHeader label="SL" align="right" active={sort.key === 'qty'} dir={sort.dir} onClick={() => toggle('qty')} />
          <SortHeader label="GMV" align="right" active={sort.key === 'gmv'} dir={sort.dir} onClick={() => toggle('gmv')} />
          <SortHeader label="Tổng phí" align="right" active={sort.key === 'fee'} dir={sort.dir} onClick={() => toggle('fee')} />
          <SortHeader label="Thực nhận" align="right" active={sort.key === 'net'} dir={sort.dir} onClick={() => toggle('net')} />
          <div>Trạng thái</div>
        </div>

        {sorted.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: '#9aa0ac', fontSize: 12.5 }}>Không có đơn khớp bộ lọc.</div>
        )}

        {sorted.map((r) => {
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
                <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>#{r.id}</div>
                <div>
                  <PlatformBadge platform={r.platform} small />
                </div>
                <div style={{ color: '#6b7180', fontSize: 11.5 }}>{fmtDayMonth(r.date)}</div>
                <div style={{ fontSize: 12 }}>{r.product}</div>
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
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7180', marginBottom: 10 }}>
                    Cấu trúc phí đơn #{r.id} — GMV {fmtInt(r.gmv)}đ → thực nhận {fmtInt(r.net)}đ
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
      </div>
    </div>
  )
}

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
