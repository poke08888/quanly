// "1 đồng GMV đi đâu?" — 100% stacked bar of the 7-segment cost composition,
// with an optional same-period comparison delta on the right of each legend row.
// Entry animation: segments grow from the left. Hover: highlight segment + tooltip.
import { useRef, useState } from 'react'
import type { Aggregate } from '../../data/types'
import { costComposition } from '../../domain/metrics'
import { fmtPct } from '../../lib/format'
import { ChartTooltip, useTooltip } from './ChartTooltip'

export function StackedCostBar({
  agg,
  prev,
  compare = false,
  fmt,
}: {
  agg: Aggregate
  prev?: Aggregate
  compare?: boolean
  fmt: (v: number) => string
}) {
  const segDef = costComposition(agg)
  // Previous-period values for the same 7 segments (matched by index/label).
  const prevDef = prev ? costComposition(prev) : []
  const segTotal = segDef.reduce((s, x) => s + Math.max(x.value, 0), 0) || 1
  let acc = 0
  const segs = segDef.map((s, i) => {
    const w = (Math.max(s.value, 0) / segTotal) * 100
    const pct = fmtPct(s.value / (agg.gmv || 1))
    // Delta vs previous. For the profit segment an INCREASE is favorable (green);
    // for every cost segment (incl. Hoàn/hủy) a DECREASE is favorable (green).
    const prevVal = prevDef[i]?.value
    const isProfit = s.label === 'Lợi nhuận'
    let delta: { text: string; color: string; show: boolean } = { text: '', color: '#9aa0ac', show: false }
    if (compare && prev && prevVal != null && prevVal !== 0) {
      const ch = (s.value - prevVal) / Math.abs(prevVal)
      const up = ch >= 0
      const good = isProfit ? up : !up
      delta = {
        text: (up ? '▲ +' : '▼ −') + Math.abs(ch * 100).toFixed(1).replace('.', ',') + '%',
        color: good ? '#0f9d6b' : '#e5484d',
        show: true,
      }
    }
    const seg = {
      label: s.label,
      color: s.color,
      txt: s.txt,
      left: acc,
      w,
      pct,
      value: fmt(s.value),
      showPct: w >= 8,
      tip: `${s.label}: ${fmt(s.value)} (${pct})`,
      delta,
    }
    acc += w
    return seg
  })

  const wrapRef = useRef<HTMLDivElement>(null)
  const { tip, show, hide } = useTooltip()
  const [hoverI, setHoverI] = useState<number | null>(null)

  function onSeg(e: React.MouseEvent, i: number) {
    setHoverI(i)
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const s = segs[i]
    show(
      e.clientX - rect.left,
      e.clientY - rect.top,
      <div>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{s.label}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontWeight: 700 }}>{s.value}</span>
          <span style={{ color: '#c9cdd8' }}>{s.pct}</span>
        </div>
      </div>,
    )
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>1 đồng GMV đi đâu?</div>
      <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>
        Cơ cấu 100% GMV — lợi nhuận & các nhóm chi phí{compare && prev ? ' · Δ so cùng kỳ' : ''}
      </div>

      <div ref={wrapRef} style={{ position: 'relative', marginTop: 16 }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 48,
            borderRadius: 9,
            overflow: 'hidden',
            background: '#eef0f4',
          }}
        >
          {segs.map((s, i) => (
            <div
              key={i}
              className="nl-chart-seg"
              style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                left: `${s.left}%`,
                width: `${s.w}%`,
                background: s.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                filter: hoverI === i ? 'brightness(1.12)' : 'none',
                opacity: hoverI == null || hoverI === i ? 1 : 0.55,
                transition: 'opacity 0.15s ease, filter 0.15s ease',
                ['--nl-i' as string]: i,
              }}
              onMouseMove={(e) => onSeg(e, i)}
              onMouseLeave={() => {
                setHoverI(null)
                hide()
              }}
            >
              {s.showPct && (
                <span
                  style={{ fontSize: 10.5, fontWeight: 700, color: s.txt, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}
                >
                  {s.pct}
                </span>
              )}
            </div>
          ))}
        </div>
        <ChartTooltip tip={tip} containerW={wrapRef.current?.clientWidth} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {segs.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              fontSize: 12.5,
              opacity: hoverI == null || hoverI === i ? 1 : 0.5,
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={() => setHoverI(i)}
            onMouseLeave={() => setHoverI(null)}
          >
            <span style={{ width: 11, height: 11, borderRadius: 4, background: s.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{s.label}</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
            <span
              style={{ color: '#6b7180', fontVariantNumeric: 'tabular-nums', width: 54, textAlign: 'right' }}
            >
              {s.pct}
            </span>
            {compare && prev && (
              <span
                style={{
                  color: s.delta.color,
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  fontSize: 11,
                  width: 68,
                  textAlign: 'right',
                }}
                title="So sánh cùng kỳ trước"
              >
                {s.delta.show ? s.delta.text : '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
