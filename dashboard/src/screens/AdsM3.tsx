import type { DashboardState } from '../state/useDashboard'
import { StatCard } from '../components/ui/KpiCard'
import { PlatformBadge } from '../components/ui/PlatformBadge'
import { fmtInt, fmtPct, fmtX } from '../lib/format'
import { deltaChip } from '../lib/deltaChip'
import type { Campaign } from '../data/types'
import { useSort } from '../lib/useSort'
import { SortHeader } from '../components/ui/SortHeader'
import { HBarChart } from '../components/charts/HBarChart'
import { Funnel } from '../components/charts/Funnel'
import { Donut, type DonutItem } from '../components/charts/Donut'

const SPEND_PALETTE = ['#3d47d9', '#0f9d6b', '#e8890c', '#8f5be8', '#0e7490', '#e5484d']
const roasColorOf = (r: number) => (r >= 4 ? '#0f9d6b' : r >= 2.5 ? '#e8890c' : '#e5484d')

function campaignVal(c: Campaign, k: string): number | string {
  switch (k) {
    case 'name': return c.name
    case 'platform': return c.platform
    case 'spend': return c.spend
    case 'impressions': return c.impressions
    case 'ctr': return c.ctr
    case 'cvr': return c.clicks ? c.conversions / c.clicks : 0
    case 'cpc': return c.cpc
    case 'cpm': return c.cpm
    case 'gmv': return c.gmv
    case 'roas': return c.roas
    default: return 0
  }
}

export function AdsM3({ s }: { s: DashboardState }) {
  const d = s.data
  const fmt = s.fmt
  const { sorted: camps, sort, toggle } = useSort<Campaign, string>(d?.campaigns ?? [], campaignVal)
  if (!d) return null

  const totSpend = camps.reduce((a, c) => a + c.spend, 0)
  const totImpr = camps.reduce((a, c) => a + c.impressions, 0)
  const totClicks = camps.reduce((a, c) => a + c.clicks, 0)
  const totAdsGmv = camps.reduce((a, c) => a + c.gmv, 0)
  const totConv = camps.reduce((a, c) => a + c.conversions, 0)
  const blendRoas = totSpend ? totAdsGmv / totSpend : 0
  const avgCvr = totClicks ? totConv / totClicks : 0

  // So sánh kỳ trước — với "Hôm nay" server cắt hôm qua đúng giờ-phút hiện tại.
  const cmp = d.adsCompare
  const chip = (cur: number, prevV: number, invert = false) =>
    cmp ? deltaChip(cur, prevV, true, invert) : undefined
  const pCtr = cmp && cmp.impressions ? cmp.clicks / cmp.impressions : 0
  const pCvr = cmp && cmp.clicks ? cmp.conversions / cmp.clicks : 0
  const pCpc = cmp && cmp.clicks ? cmp.spend / cmp.clicks : 0
  const pRoas = cmp && cmp.spend ? cmp.gmv / cmp.spend : 0
  const aov = totConv ? totAdsGmv / totConv : 0
  const pAov = cmp && cmp.conversions ? cmp.gmv / cmp.conversions : 0
  const cmpNote = cmp
    ? cmp.aligned
      ? cmp.est
        ? 'So với cùng giờ-phút hôm qua (chi phí thật · phễu ước tính phân bổ — snapshot ads bắt đầu ghi từ hôm nay, mai là số thật)'
        : 'So với cùng giờ-phút hôm qua (dữ liệu thật)'
      : 'So với kỳ trước liền kề'
    : null

  // ----- charts -----
  const roasItems = [...camps]
    .sort((a, b) => b.roas - a.roas)
    .map((c) => ({ label: c.name, value: c.roas, color: roasColorOf(c.roas) }))

  const funnelStages = [
    { label: 'Hiển thị', value: totImpr, color: '#3d47d9' },
    { label: 'Click', value: totClicks, color: '#8f5be8' },
    { label: 'Chuyển đổi', value: totConv, color: '#0f9d6b' },
  ]

  let spendItems: DonutItem[]
  let spendTitle: string
  if (s.platform === 'all') {
    const tkSpend = camps.filter((c) => c.platform === 'tiktok').reduce((a, c) => a + c.spend, 0)
    const spSpend = camps.filter((c) => c.platform === 'shopee').reduce((a, c) => a + c.spend, 0)
    spendItems = [
      { label: 'TikTok Shop', value: tkSpend, color: '#191c22' },
      { label: 'Shopee', value: spSpend, color: '#ee4d2d' },
    ]
    spendTitle = 'Tỷ trọng chi phí theo sàn'
  } else {
    spendItems = [...camps]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 6)
      .map((c, i) => ({ label: c.name, value: c.spend, color: SPEND_PALETTE[i % SPEND_PALETTE.length] }))
    spendTitle = 'Tỷ trọng chi phí ads'
  }

  return (
    <div className="nl-fade">
      {cmpNote && (
        <div style={{ fontSize: 11, color: '#9aa0ac', marginBottom: 8 }}>{cmpNote}</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label="Chi phí ads" value={fmt(totSpend)} sub={`${camps.length} campaign đang chạy`} delta={cmp ? chip(totSpend, cmp.spend, true) : undefined} />
        <StatCard label="Hiển thị" value={fmtInt(totImpr)} sub="impressions" delta={cmp ? chip(totImpr, cmp.impressions) : undefined} />
        <StatCard label="CTR trung bình" value={fmtPct(totImpr ? totClicks / totImpr : 0, 2)} sub={`${fmtInt(totClicks)} lượt click`} delta={cmp ? chip(totImpr ? totClicks / totImpr : 0, pCtr) : undefined} />
        <StatCard label="CVR trung bình" value={fmtPct(avgCvr, 2)} sub={`${fmtInt(totConv)} chuyển đổi`} delta={cmp ? chip(avgCvr, pCvr) : undefined} />
        <StatCard label="CPC trung bình" value={fmt(totClicks ? totSpend / totClicks : 0)} sub="chi phí / click" delta={cmp ? chip(totClicks ? totSpend / totClicks : 0, pCpc, true) : undefined} />
        <StatCard
          label="ROAS gộp"
          value={fmtX(blendRoas)}
          sub="GMV từ ads / chi phí"
          valColor={blendRoas >= 4 ? '#0f9d6b' : blendRoas >= 2.5 ? '#e8890c' : '#e5484d'}
          delta={cmp ? chip(blendRoas, pRoas) : undefined}
        />
        <StatCard label="Đơn từ ads" value={fmtInt(totConv)} sub="chuyển đổi ra đơn" delta={cmp ? chip(totConv, cmp.conversions) : undefined} />
        <StatCard label="AOV ads" value={fmt(aov)} sub="GMV ads / đơn ads" delta={cmp ? chip(aov, pAov) : undefined} />
      </div>

      <div className="nl-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
        <Funnel
          stages={funnelStages}
          format={fmtInt}
          title="Phễu Hiển thị → Click → Chuyển đổi"
          sub={`CTR ${fmtPct(totImpr ? totClicks / totImpr : 0, 2)} · CVR ${fmtPct(avgCvr, 2)}`}
        />
        <Donut title={spendTitle} sub="Theo chi phí ads" items={spendItems} fmt={fmt} centerLabel="Chi phí" />
      </div>

      <div style={{ marginTop: 14 }}>
        <HBarChart items={roasItems} format={fmtX} title="ROAS theo campaign" sub="Sắp xếp theo ROAS giảm dần" />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, marginTop: 14, overflow: 'auto hidden' }}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Hiệu suất theo campaign</div>
          <div style={{ fontSize: 11, color: '#9aa0ac' }}>CPM Shopee tự tính từ chi phí/hiển thị</div>
        </div>
        <div className="nl-trow" style={{ ...grid, ...headRow }}>
          <SortHeader label="Campaign" active={sort.key === 'name'} dir={sort.dir} onClick={() => toggle('name')} />
          <SortHeader label="Sàn" active={sort.key === 'platform'} dir={sort.dir} onClick={() => toggle('platform')} />
          <SortHeader label="Chi phí" align="right" active={sort.key === 'spend'} dir={sort.dir} onClick={() => toggle('spend')} />
          <SortHeader label="Hiển thị" align="right" active={sort.key === 'impressions'} dir={sort.dir} onClick={() => toggle('impressions')} />
          <SortHeader label="CTR" align="right" active={sort.key === 'ctr'} dir={sort.dir} onClick={() => toggle('ctr')} />
          <SortHeader label="CVR" align="right" active={sort.key === 'cvr'} dir={sort.dir} onClick={() => toggle('cvr')} />
          <SortHeader label="CPC" align="right" active={sort.key === 'cpc'} dir={sort.dir} onClick={() => toggle('cpc')} />
          <SortHeader label="CPM" align="right" active={sort.key === 'cpm'} dir={sort.dir} onClick={() => toggle('cpm')} />
          <SortHeader label="GMV" align="right" active={sort.key === 'gmv'} dir={sort.dir} onClick={() => toggle('gmv')} />
          <SortHeader label="ROAS" align="right" active={sort.key === 'roas'} dir={sort.dir} onClick={() => toggle('roas')} />
        </div>
        {camps.map((c) => {
          const roasColor = c.roas >= 4 ? '#0f9d6b' : c.roas >= 2.5 ? '#e8890c' : '#e5484d'
          return (
            <div key={c.id} className="nl-trow" style={{ ...grid, ...bodyRow }}>
              <div>
                <span style={{ fontWeight: 600 }}>{c.name}</span>{' '}
                <span style={{ fontSize: 10.5, color: '#8a909c', background: '#f1f2f6', borderRadius: 5, padding: '2px 6px', marginLeft: 6 }}>
                  {c.type}
                </span>
              </div>
              <div>
                <PlatformBadge platform={c.platform} />
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.spend)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6b7180' }}>{fmtInt(c.impressions)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(c.ctr, 2)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(c.clicks ? c.conversions / c.clicks : 0, 2)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.cpc)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6b7180' }}>{fmt(c.cpm)}</div>
              <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.gmv)}</div>
              <div style={{ textAlign: 'right', fontWeight: 800, color: roasColor, fontVariantNumeric: 'tabular-nums' }}>{fmtX(c.roas)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const grid = {
  display: 'grid',
  gridTemplateColumns: '1.7fr 80px 100px 100px 64px 64px 85px 85px 95px 70px',
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
