import type { DashboardState } from '../state/useDashboard'
import { StatCard } from '../components/ui/KpiCard'
import { PlatformBadge } from '../components/ui/PlatformBadge'
import { fmtPct, fmtX } from '../lib/format'
import type { Creator } from '../data/types'
import { useSort } from '../lib/useSort'
import { SortHeader } from '../components/ui/SortHeader'
import { HBarChart } from '../components/charts/HBarChart'
import { Donut, type DonutItem } from '../components/charts/Donut'
import { BubbleChart, type BubblePoint } from '../components/charts/BubbleChart'

const roiColorOf = (r: number) => (r >= 5 ? '#0f9d6b' : r >= 3 ? '#e8890c' : '#e5484d')
const TIER_COLORS: Record<string, string> = { Macro: '#3d47d9', Mid: '#8f5be8', Micro: '#0e7490' }

const AV_COLORS = ['#3d47d9', '#0f9d6b', '#e8890c', '#8f5be8', '#e5484d', '#0e7490']

function creatorVal(c: Creator, k: string): number | string {
  switch (k) {
    case 'name': return c.name
    case 'platform': return c.platform
    case 'tier': return c.tier
    case 'videos': return c.videos
    case 'gmv': return c.gmv
    case 'commission': return c.commission
    case 'booking': return c.booking
    case 'cost': return c.cost
    case 'roi': return c.roi
    default: return 0
  }
}

export function KocM4({ s }: { s: DashboardState }) {
  const d = s.data
  const fmt = s.fmt
  const { sorted: kocs, sort, toggle } = useSort<Creator, string>(d?.creators ?? [], creatorVal)
  if (!d) return null
  const kocGmv = kocs.reduce((a, c) => a + c.gmv, 0)
  const kocCost = kocs.reduce((a, c) => a + c.cost, 0)

  const pfLabel = s.platform === 'all' ? 'TikTok + Shopee' : s.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee'

  // ----- charts -----
  const roiItems = [...kocs]
    .sort((a, b) => b.roi - a.roi)
    .map((c) => ({ label: c.name, value: c.roi, color: roiColorOf(c.roi) }))

  const tierMap = new Map<string, number>()
  for (const c of kocs) tierMap.set(c.tier, (tierMap.get(c.tier) ?? 0) + c.gmv)
  const tierItems: DonutItem[] = [...tierMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tier, gmv]) => ({ label: tier, value: gmv, color: TIER_COLORS[tier] ?? '#9aa0ac' }))

  const costItems: DonutItem[] = [
    { label: 'Hoa hồng', value: kocs.reduce((a, c) => a + c.commission, 0), color: '#5ea08f' },
    { label: 'Booking', value: kocs.reduce((a, c) => a + c.booking, 0), color: '#a98a5c' },
  ]

  const bubblePoints: BubblePoint[] = kocs.map((c) => ({
    x: c.cost,
    y: c.gmv,
    size: c.roi,
    color: c.platform === 'tiktok' ? '#191c22' : '#ee4d2d',
    label: c.name,
  }))

  return (
    <div className="nl-fade">
      {s.platform !== 'tiktok' && (
        <div
          style={{
            background: '#fff8ee',
            border: '1px solid #f2ddb8',
            borderRadius: 12,
            padding: '10px 16px',
            marginBottom: 14,
            fontSize: 12.5,
            color: '#8a5a12',
          }}
        >
          Số liệu KOC Shopee lấy từ import CSV (Shopee Affiliate/AMS) — cập nhật lần cuối 01/07/2026. Không có API tự động.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label="KOC đang hoạt động" value={kocs.length} sub={pfLabel} />
        <StatCard label="GMV từ KOC" value={fmt(kocGmv)} sub={`${fmtPct(kocGmv / (d.cur.gmv || 1))} tổng GMV`} />
        <StatCard label="Chi phí KOC" value={fmt(kocCost)} sub="hoa hồng + booking" />
        <StatCard
          label="ROI trung bình"
          value={fmtX(kocCost ? kocGmv / kocCost : 0)}
          sub="GMV / chi phí KOC"
          valColor={kocGmv / (kocCost || 1) >= 4 ? '#0f9d6b' : '#e8890c'}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <HBarChart items={roiItems} format={fmtX} title="ROI theo KOC" sub="Sắp xếp theo ROI giảm dần" />
      </div>

      <div className="nl-grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
        <Donut title="Đóng góp GMV theo phân khúc" sub="Macro · Mid · Micro" items={tierItems} fmt={fmt} />
        <Donut title="Cơ cấu chi phí KOC" sub="Hoa hồng + Booking" items={costItems} fmt={fmt} centerLabel="Chi phí" />
        <BubbleChart
          points={bubblePoints}
          xLabel="Chi phí"
          yLabel="GMV"
          format={fmt}
          title="Bong bóng GMV × Chi phí"
          sub="Kích thước = ROI · màu theo sàn"
        />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, marginTop: 14, overflow: 'auto hidden' }}>
        <div style={{ padding: '16px 20px 12px', fontSize: 13.5, fontWeight: 700 }}>ROI từng KOC</div>
        <div className="nl-trow" style={{ ...grid, ...headRow }}>
          <SortHeader label="KOC" active={sort.key === 'name'} dir={sort.dir} onClick={() => toggle('name')} />
          <SortHeader label="Sàn" active={sort.key === 'platform'} dir={sort.dir} onClick={() => toggle('platform')} />
          <SortHeader label="Phân khúc" active={sort.key === 'tier'} dir={sort.dir} onClick={() => toggle('tier')} />
          <SortHeader label="Video" align="right" active={sort.key === 'videos'} dir={sort.dir} onClick={() => toggle('videos')} />
          <SortHeader label="GMV" align="right" active={sort.key === 'gmv'} dir={sort.dir} onClick={() => toggle('gmv')} />
          <SortHeader label="HH KOC" align="right" active={sort.key === 'commission'} dir={sort.dir} onClick={() => toggle('commission')} />
          <SortHeader label="Booking" align="right" active={sort.key === 'booking'} dir={sort.dir} onClick={() => toggle('booking')} />
          <SortHeader label="Tổng chi" align="right" active={sort.key === 'cost'} dir={sort.dir} onClick={() => toggle('cost')} />
          <SortHeader label="ROI" align="right" active={sort.key === 'roi'} dir={sort.dir} onClick={() => toggle('roi')} />
        </div>
        {kocs.map((c, i) => {
          const initial = c.name
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()
          const roiColor = c.roi >= 5 ? '#0f9d6b' : c.roi >= 3 ? '#e8890c' : '#e5484d'
          return (
            <div key={c.id} className="nl-trow" style={{ ...grid, ...bodyRow }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: AV_COLORS[i % AV_COLORS.length],
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {initial}
                </span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600 }}>{c.name}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: '#9aa0ac' }}>{c.follows} follower</span>
                </span>
              </div>
              <div>
                <PlatformBadge platform={c.platform} />
              </div>
              <div style={{ fontSize: 11.5, color: '#6b7180' }}>{c.tier}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.videos}</div>
              <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.gmv)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.commission)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.booking > 0 ? fmt(c.booking) : '—'}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6b7180' }}>{fmt(c.cost)}</div>
              <div style={{ textAlign: 'right', fontWeight: 800, color: roiColor, fontVariantNumeric: 'tabular-nums' }}>{fmtX(c.roi)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const grid = {
  display: 'grid',
  gridTemplateColumns: '1.6fr 80px 80px 60px 105px 105px 105px 105px 70px',
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
  padding: '11px 20px',
  fontSize: 12.5,
  alignItems: 'center',
  borderBottom: '1px solid #f4f5f8',
} as const
