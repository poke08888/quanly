import { useState } from 'react'
import type { DashboardState } from '../state/useDashboard'
import { KpiCard } from '../components/ui/KpiCard'
import { LineChart } from '../components/charts/LineChart'
import { buildChart } from '../lib/chartBuckets'
import { StackedCostBar } from '../components/charts/StackedCostBar'
import { Donut, type DonutItem } from '../components/charts/Donut'
import { GmvSourceBreakdown } from '../components/charts/GmvSourceBreakdown'
import { deltaChip } from '../lib/deltaChip'
import { deriveTargets, kpiProgress, paceColor, periodSpan, type KpiPeriod } from '../lib/kpiProgress'
import { TODAY } from '../lib/period'
import { fmtInt, fmtPct, fmtX } from '../lib/format'
import { SOURCE_COLORS, SOURCE_LABELS } from '../lib/tokens'
import type { ProductPerf } from '../data/types'
import { useSort } from '../lib/useSort'
import { SortHeader } from '../components/ui/SortHeader'

function productVal(t: ProductPerf, k: string): number | string {
  switch (k) {
    case 'name': return t.name
    case 'sku': return t.sku
    case 'qty': return t.qty
    case 'gmv': return t.gmv
    case 'share': return t.share
    case 'margin': return t.marginPct
    default: return 0
  }
}

export function OverviewM1({ s }: { s: DashboardState }) {
  const d = s.data
  const { sorted: sortedTops, sort: topSort, toggle: topToggle } = useSort<ProductPerf, string>(
    d?.topProducts ?? [],
    productVal,
    { key: 'gmv', dir: 'desc' },
  )
  if (!d) return null
  const { cur, prev } = d
  const fmt = s.fmt

  const marginColor = cur.marginPct >= 0.08 ? '#0f9d6b' : cur.marginPct >= 0.03 ? '#e8890c' : '#e5484d'
  const roasColor = cur.roas >= 4 ? '#0f9d6b' : cur.roas >= 2.5 ? '#e8890c' : '#e5484d'
  const cirColor = cur.cir <= 0.25 ? '#0f9d6b' : cur.cir <= 0.35 ? '#e8890c' : '#e5484d'

  // ----- alerts -----
  const thr = s.alertMarginPct / 100
  const alertItems: string[] = []
  if (cur.marginPct < thr)
    alertItems.push(
      `Biên lợi nhuận ${fmtPct(cur.marginPct)} dưới ngưỡng ${fmtPct(thr, 0)} — kiểm tra voucher và chi phí ads.`,
    )
  const badCamps = d.campaigns.filter((c) => c.roas < 3)
  if (badCamps.length)
    alertItems.push(
      `${badCamps.length} campaign có ROAS dưới 3x: ${badCamps
        .slice(0, 2)
        .map((c) => c.name)
        .join(', ')}${badCamps.length > 2 ? '…' : ''} — cân nhắc giảm ngân sách.`,
    )
  const lowMargin = d.topProducts.filter((t) => t.marginPct < 0.15)
  if (lowMargin.length)
    alertItems.push(
      `${lowMargin.length} SKU biên LN% thấp dưới 15%: ${lowMargin.map((t) => t.sku).join(', ')}.`,
    )

  // ----- pie -----
  let pieItems: DonutItem[]
  let pieTitle: string
  let pieSub: string
  if (s.platform === 'all') {
    pieItems = [
      { label: 'TikTok Shop', value: d.tkAgg.gmv, color: '#191c22' },
      { label: 'Shopee', value: d.spAgg.gmv, color: '#ee4d2d' },
    ]
    pieTitle = 'Tỷ trọng doanh thu theo sàn'
    pieSub = 'GMV TikTok Shop vs Shopee — chọn riêng từng sàn để xem theo nguồn'
  } else {
    pieItems = (['live', 'video', 'card', 'search'] as const).map((k) => ({
      label: SOURCE_LABELS[k],
      value: cur.sources[k],
      color: SOURCE_COLORS[k],
    }))
    pieTitle = 'GMV theo nguồn — ' + (s.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee')
    pieSub = 'LIVE · Video · Gian hàng/Card · Tìm kiếm'
  }

  const { points: chartPoints, note: chartNote } = buildChart(d.series, s.period)

  const tops = d.topProducts
  const maxShare = tops.reduce((m, t) => Math.max(m, t.share), 0) || 1
  const topRows = sortedTops.slice(0, 8)

  return (
    <div className="nl-fade">
      {alertItems.length > 0 && (
        <div
          style={{
            background: '#fdf1f1',
            border: '1px solid #f3c8c8',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 18,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1.3 }}>⚠</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#b3261e' }}>Cảnh báo lợi nhuận</div>
            {alertItems.map((t, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#7d2b26', marginTop: 3 }}>
                • {t}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: 12 }}>
        <KpiCard label="GMV" value={fmt(cur.gmv)} accent="#3d47d9" delta={deltaChip(cur.gmv, prev.gmv, s.compare)} />
        <KpiCard label="Doanh thu NET" value={fmt(cur.netRevenue)} accent="#3d47d9" delta={deltaChip(cur.netRevenue, prev.netRevenue, s.compare)} />
        <KpiCard
          label="Lợi nhuận"
          value={fmt(cur.profit)}
          accent={marginColor}
          valColor={cur.profit < 0 ? '#e5484d' : '#191c22'}
          delta={deltaChip(cur.profit, prev.profit, s.compare)}
        />
        <KpiCard label="Biên LN %" value={fmtPct(cur.marginPct)} accent={marginColor} valColor={marginColor} delta={deltaChip(cur.marginPct, prev.marginPct, s.compare)} />
        <KpiCard label="ROAS" value={fmtX(cur.roas)} accent={roasColor} valColor={roasColor} delta={deltaChip(cur.roas, prev.roas, s.compare)} />
        <KpiCard label="CIR %" value={fmtPct(cur.cir)} accent={cirColor} valColor={cirColor} sub="Ads + KOC / GMV" delta={deltaChip(cur.cir, prev.cir, s.compare, true)} />
        <KpiCard label="Đơn hàng" value={fmtInt(cur.orders)} accent="#3d47d9" delta={deltaChip(cur.orders, prev.orders, s.compare)} />
      </div>

      <div className="nl-grid-2" style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 14, marginTop: 14 }}>
        <LineChart points={chartPoints} fmt={fmt} note={chartNote} />
        <StackedCostBar agg={cur} prev={prev} compare={s.compare} fmt={fmt} />
      </div>

      <div className="nl-grid-3" style={{ display: 'grid', gridTemplateColumns: s.platform === 'tiktok' ? '1fr 1.9fr 0.7fr' : '1.5fr 1.3fr 0.85fr', gap: 14, marginTop: 14, alignItems: 'stretch' }}>
        <KpiProgressCard s={s} />
        {s.platform === 'tiktok' ? (
          <GmvSourceBreakdown sources={cur.sources} prevSources={prev.sources} fmt={fmt} />
        ) : (
          <Donut title={pieTitle} sub={pieSub} items={pieItems} fmt={fmt} />
        )}
        <RatesCard
          cancelledRate={cur.cancelled / (cur.gmv || 1)}
          cancelledGmv={cur.cancelled}
          returnedRate={cur.returned / (cur.gmv || 1)}
          returnedGmv={cur.returned}
          fmt={fmt}
        />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, overflow: 'auto hidden', marginTop: 14 }}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Top sản phẩm bán chạy</div>
          <div style={{ fontSize: 11, color: '#9aa0ac' }}>Biên LN% sau COGS + phí sàn</div>
        </div>
        <div className="nl-trow" style={{ ...topGrid, ...headRow }}>
          <div>#</div>
          <SortHeader label="Sản phẩm" active={topSort.key === 'name'} dir={topSort.dir} onClick={() => topToggle('name')} />
          <SortHeader label="SKU" active={topSort.key === 'sku'} dir={topSort.dir} onClick={() => topToggle('sku')} />
          <SortHeader label="SL" align="right" active={topSort.key === 'qty'} dir={topSort.dir} onClick={() => topToggle('qty')} />
          <SortHeader label="GMV" align="right" active={topSort.key === 'gmv'} dir={topSort.dir} onClick={() => topToggle('gmv')} />
          <SortHeader label="Tỉ trọng" active={topSort.key === 'share'} dir={topSort.dir} onClick={() => topToggle('share')} />
          <SortHeader label="Biên LN%" align="right" active={topSort.key === 'margin'} dir={topSort.dir} onClick={() => topToggle('margin')} />
        </div>
        <TopTable rows={topRows} fmt={fmt} maxShare={maxShare} />
      </div>
    </div>
  )
}

/** Separate component for top-product table rows with hover state */
function TopTable({ rows, fmt, maxShare }: { rows: ProductPerf[]; fmt: (v: number) => string; maxShare: number }) {
  const [hoverI, setHoverI] = useState<number | null>(null)
  return (
    <>
      {rows.map((t, i) => {
        const mColor = t.marginPct >= 0.25 ? '#0f9d6b' : t.marginPct >= 0.15 ? '#e8890c' : '#e5484d'
        const shareW = ((t.share / maxShare) * 100).toFixed(1)
        const isHovered = hoverI === i
        return (
          <div
            key={t.sku}
            className="nl-trow"
            style={{
              ...topGrid,
              ...bodyRow,
              background: isHovered ? '#f7f8ff' : 'transparent',
              transition: 'background 0.12s ease',
              cursor: 'default',
            }}
            onMouseEnter={() => setHoverI(i)}
            onMouseLeave={() => setHoverI(null)}
          >
            <div style={{ color: isHovered ? '#3d47d9' : '#9aa0ac', fontWeight: 700, transition: 'color 0.12s ease' }}>{i + 1}</div>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.name}>{t.name}</div>
            <div style={{ color: '#7c828f', fontSize: 11.5 }}>{t.sku}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(t.qty)}</div>
            <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.gmv)}</div>
            <div>
              <div style={{ height: 7, background: '#eef0f4', borderRadius: 4 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${shareW}%`,
                    background: '#3d47d9',
                    borderRadius: 4,
                    opacity: isHovered ? 1 : 0.75,
                    transition: 'opacity 0.12s ease',
                  }}
                />
              </div>
            </div>
            <div style={{ textAlign: 'right', fontWeight: 700, color: mColor, fontVariantNumeric: 'tabular-nums' }}>
              {fmtPct(t.marginPct)}
            </div>
          </div>
        )
      })}
    </>
  )
}

/** Merged cancel + return rate card (two labeled rows in one card). */
function RatesCard({
  cancelledRate,
  cancelledGmv,
  returnedRate,
  returnedGmv,
  fmt,
}: {
  cancelledRate: number
  cancelledGmv: number
  returnedRate: number
  returnedGmv: number
  fmt: (v: number) => string
}) {
  const [hoverI, setHoverI] = useState<number | null>(null)
  const rows = [
    { label: 'Tỉ lệ hủy đơn', rate: cancelledRate, gmv: cancelledGmv, suffix: 'GMV bị hủy', warn: false },
    { label: 'Tỉ lệ hoàn đơn', rate: returnedRate, gmv: returnedGmv, suffix: 'GMV hoàn về', warn: returnedRate > 0.03 },
  ]
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, padding: '16px 18px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
      {rows.map((r, i) => {
        const isH = hoverI === i
        return (
          <div
            key={i}
            style={{
              ...(i > 0 ? { borderTop: '1px solid #f0f1f5', paddingTop: 14 } : {}),
              borderRadius: 10,
              padding: isH ? '8px 10px' : '0',
              margin: isH ? '-8px -10px' : '0',
              background: isH ? '#f7f8ff' : 'transparent',
              transition: 'background 0.15s ease, padding 0.15s ease, margin 0.15s ease',
              cursor: 'default',
            }}
            onMouseEnter={() => setHoverI(i)}
            onMouseLeave={() => setHoverI(null)}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#7c828f' }}>{r.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2, fontVariantNumeric: 'tabular-nums', color: r.warn ? '#e8890c' : '#191c22', transition: 'transform 0.15s ease', transform: isH ? 'scale(1.04)' : 'none', transformOrigin: 'left center' }}>
              {fmtPct(r.rate)}
            </div>
            <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>
              {fmt(r.gmv)} {r.suffix}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Compact KPI-vs-target card: 4 period rows (Ngày/Tháng/Quý/Năm), from DERIVED
 *  targets + carryover helper. Sits as the 3rd column of the rate row. */
function KpiProgressCard({ s }: { s: DashboardState }) {
  const d = s.data
  if (!d) return null
  const fmt = s.fmt
  const derived = deriveTargets(d.kpiMonthly.months, TODAY)
  const targetOf: Record<KpiPeriod, number> = {
    daily: derived.daily,
    monthly: derived.monthly,
    quarterly: derived.quarterly,
    yearly: derived.yearly,
  }
  const rows: { key: KpiPeriod; label: string }[] = [
    { key: 'daily', label: 'Ngày' },
    { key: 'monthly', label: 'Tháng' },
    { key: 'quarterly', label: 'Quý' },
    { key: 'yearly', label: 'Năm' },
  ]
  const monthP = kpiProgress(targetOf.monthly, d.kpiActuals.monthly, periodSpan('monthly', TODAY))
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, padding: '16px 18px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Tiến độ mục tiêu KPI</div>
      <div style={{ fontSize: 10.5, color: '#9aa0ac', marginTop: 1 }}>Thực đạt so mục tiêu (suy ra từ tháng)</div>
      <KpiProgressRows rows={rows} targetOf={targetOf} actuals={d.kpiActuals} fmt={fmt} />
      <div style={{ fontSize: 10.5, color: monthP.reached ? '#0f9d6b' : monthP.behindPace ? '#e5484d' : '#6b7180', marginTop: 10, fontWeight: 600 }}>
        {monthP.reached ? '✓ Đã đạt mục tiêu tháng' : `Tháng: cần ${fmt(monthP.adjustedDaily)}/ngày`}
      </div>
    </div>
  )
}

/** Sub-component for KPI progress rows with hover state */
function KpiProgressRows({
  rows,
  targetOf,
  actuals,
  fmt,
}: {
  rows: { key: KpiPeriod; label: string }[]
  targetOf: Record<KpiPeriod, number>
  actuals: Record<KpiPeriod, number>
  fmt: (v: number) => string
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12, flex: 1, justifyContent: 'center' }}>
      {rows.map((r) => {
        const p = kpiProgress(targetOf[r.key], actuals[r.key], periodSpan(r.key, TODAY))
        const color = paceColor(p.pct)
        const isH = hoverKey === r.key
        return (
          <div
            key={r.key}
            style={{
              borderRadius: 8,
              padding: isH ? '6px 8px' : '0',
              margin: isH ? '-6px -8px' : '0',
              background: isH ? '#f7f8ff' : 'transparent',
              transition: 'background 0.15s ease, padding 0.15s ease, margin 0.15s ease',
              cursor: 'default',
            }}
            onMouseEnter={() => setHoverKey(r.key)}
            onMouseLeave={() => setHoverKey(null)}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
              <span style={{ fontWeight: 600, width: 40 }}>{r.label}</span>
              {isH && (
                <span style={{ fontSize: 10, color: '#9aa0ac', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(actuals[r.key])} / {fmt(targetOf[r.key])}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', transition: 'transform 0.15s ease', transform: isH ? 'scale(1.1)' : 'none', display: 'inline-block' }}>
                {fmtPct(p.pct)}
              </span>
            </div>
            <div style={{ height: 5, background: '#eef0f4', borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(p.pct, 1) * 100}%`,
                  background: color,
                  borderRadius: 3,
                  transition: 'height 0.15s ease',
                  ...(isH ? { height: '100%' } : {}),
                  boxShadow: isH ? `0 0 6px ${color}88` : 'none',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const topGrid = {
  display: 'grid',
  gridTemplateColumns: '34px 1.7fr 88px 56px 96px 1fr 84px',
  gap: 10,
  minWidth: 620,
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
