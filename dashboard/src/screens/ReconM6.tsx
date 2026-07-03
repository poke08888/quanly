import type { DashboardState } from '../state/useDashboard'
import { StatCard } from '../components/ui/KpiCard'
import { PlatformBadge } from '../components/ui/PlatformBadge'
import { fmtDayMonth, fmtInt, fmtPct } from '../lib/format'
import { FEE_KEYS } from '../data/types'
import type { ReconOrder } from '../data/types'
import { FEE_LABELS } from '../lib/tokens'
import { useSort } from '../lib/useSort'
import { SortHeader } from '../components/ui/SortHeader'

function reconVal(r: ReconOrder, k: string): number | string {
  switch (k) {
    case 'id': return r.id
    case 'platform': return r.platform
    case 'date': return r.date
    case 'qty': return r.qty
    case 'gmv': return r.gmv
    case 'fee': return FEE_KEYS.reduce((a, key) => a + r.fees[key], 0)
    case 'net': return r.net
    default: return 0
  }
}

const FILTERS: { id: 'all' | 'settled' | 'pending'; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'settled', label: 'Đã đối soát' },
  { id: 'pending', label: 'Tạm tính' },
]

export function ReconM6({ s }: { s: DashboardState }) {
  const d = s.data
  const fmt = s.fmt
  const all = d?.reconOrders ?? []
  const recon = all.filter(
    (r) => s.reconFilter === 'all' || (s.reconFilter === 'settled') === r.isSettled,
  )
  const { sorted: reconRows, sort, toggle } = useSort<ReconOrder, string>(recon, reconVal)
  if (!d) return null
  const settled = all.filter((r) => r.isSettled)
  const pending = all.filter((r) => !r.isSettled)

  return (
    <div className="nl-fade">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Tổng đơn kỳ này" value={fmtInt(all.length)} sub="trong cửa sổ đối soát" />
        <StatCard label="Đã đối soát" value={fmtPct(all.length ? settled.length / all.length : 0, 0)} sub={`${settled.length} đơn — tiền đã về`} valColor="#0f9d6b" />
        <StatCard label="Tạm tính (chờ settle)" value={fmtInt(pending.length)} sub="T+7 ~ T+15 sau giao hàng" valColor="#e8890c" />
        <StatCard label="Giá trị chờ về" value={fmt(pending.reduce((a, r) => a + r.net, 0))} sub="thực nhận dự kiến" />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, overflow: 'auto hidden' }}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Đơn hàng & phí breakdown</div>
            <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>Bấm vào đơn để xem 9 trường phí chuẩn hoá</div>
          </div>
          <div style={{ display: 'flex', gap: 3, background: '#e7e9ef', borderRadius: 9, padding: 3 }}>
            {FILTERS.map((f) => {
              const active = s.reconFilter === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => s.setReconFilter(f.id)}
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
        <div className="nl-trow" style={{ ...grid, ...headRow }}>
          <SortHeader label="Mã đơn" active={sort.key === 'id'} dir={sort.dir} onClick={() => toggle('id')} />
          <SortHeader label="Sàn" active={sort.key === 'platform'} dir={sort.dir} onClick={() => toggle('platform')} />
          <SortHeader label="Ngày" active={sort.key === 'date'} dir={sort.dir} onClick={() => toggle('date')} />
          <div>Sản phẩm</div>
          <SortHeader label="SL" align="right" active={sort.key === 'qty'} dir={sort.dir} onClick={() => toggle('qty')} />
          <SortHeader label="GMV" align="right" active={sort.key === 'gmv'} dir={sort.dir} onClick={() => toggle('gmv')} />
          <SortHeader label="Tổng phí" align="right" active={sort.key === 'fee'} dir={sort.dir} onClick={() => toggle('fee')} />
          <SortHeader label="Thực nhận" align="right" active={sort.key === 'net'} dir={sort.dir} onClick={() => toggle('net')} />
          <div>Trạng thái</div>
        </div>
        {reconRows.map((r) => {
          const totalFee = FEE_KEYS.reduce((a, k) => a + r.fees[k], 0)
          const expanded = s.expandedOrder === r.id
          const stFg = r.isSettled ? '#0f6b4c' : '#8a5a12'
          const stBg = r.isSettled ? '#e3f5ec' : '#fdf3e0'
          return (
            <div key={r.id}>
              <div
                className="nl-trow"
                onClick={() => s.setExpandedOrder(expanded ? null : r.id)}
                style={{ ...grid, ...bodyRow, cursor: 'pointer', background: expanded ? '#f7f8fa' : '#fff' }}
              >
                <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>#{r.id}</div>
                <div>
                  <PlatformBadge platform={r.platform} small />
                </div>
                <div style={{ color: '#6b7180', fontSize: 11.5 }}>{fmtDayMonth(r.date)}</div>
                <div style={{ fontSize: 12 }}>
                  {r.product} <span style={{ color: '#9aa0ac', fontSize: 10.5 }}>×{r.qty}</span>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.qty}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(r.gmv)}</div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#b3261e' }}>−{fmtInt(totalFee)}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0f9d6b' }}>{fmtInt(r.net)}</div>
                <div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: stFg, background: stBg, borderRadius: 6, padding: '3px 8px' }}>
                    {r.isSettled ? 'Đã đối soát' : 'Tạm tính'}
                  </span>
                </div>
              </div>
              {expanded && (
                <div className="nl-feegrid" style={{ background: '#fafbfd', borderBottom: '1px solid #eef0f4', padding: '14px 20px 16px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
                  {FEE_KEYS.map((k) => (
                    <div key={k} style={{ background: '#fff', border: '1px solid #e9ebf0', borderRadius: 9, padding: '9px 11px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#9aa0ac', letterSpacing: '0.03em' }}>{k}</div>
                      <div style={{ fontSize: 11, color: '#6b7180', marginTop: 1 }}>{FEE_LABELS[k]}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, fontVariantNumeric: 'tabular-nums', color: r.fees[k] > 0 ? '#b3261e' : '#9aa0ac' }}>
                        {r.fees[k] > 0 ? '−' + fmtInt(r.fees[k]) : '0'}
                      </div>
                    </div>
                  ))}
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
  gridTemplateColumns: '105px 78px 82px 1.5fr 45px 105px 105px 105px 100px',
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
