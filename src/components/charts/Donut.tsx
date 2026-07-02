// Donut chart with center label + legend — GMV by platform ('all') or by source.
// Entry animation: slices scale/fade in. Hover: emphasize hovered slice (dim others)
// + tooltip with label · value · % of total.
import { useRef, useState } from 'react'
import { fmtPct, fmtVND } from '../../lib/format'
import { ChartTooltip, useTooltip } from './ChartTooltip'

export interface DonutItem {
  label: string
  value: number
  color: string
}

export function Donut({
  title,
  sub,
  items,
  fmt,
  centerLabel = 'GMV',
  embedded = false,
}: {
  title: string
  sub: string
  items: DonutItem[]
  fmt: (v: number) => string
  /** Caption under the center total (e.g. 'GMV', 'Chi phí'). */
  centerLabel?: string
  /** When true, render only the SVG + a compact legend (no card/title wrapper) —
   *  used inside a parent panel that supplies its own card + heading. */
  embedded?: boolean
}) {
  const total = items.reduce((s, x) => s + x.value, 0) || 1
  const wrapRef = useRef<HTMLDivElement>(null)
  const { tip, show, hide } = useTooltip()
  const [hoverI, setHoverI] = useState<number | null>(null)

  const arc = (a0: number, a1: number) => {
    const cx = 100
    const cy = 100
    const R = 88
    const r = 56
    const P = (rad: number, a: number) =>
      (cx + rad * Math.cos(a)).toFixed(2) + ',' + (cy + rad * Math.sin(a)).toFixed(2)
    const large = a1 - a0 > Math.PI ? 1 : 0
    return (
      'M' + P(R, a0) + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + P(R, a1) +
      ' L' + P(r, a1) + ' A' + r + ',' + r + ' 0 ' + large + ' 0 ' + P(r, a0) + ' Z'
    )
  }

  let ang = -Math.PI / 2
  const slices = items.map((x) => {
    const a0 = ang
    const a1 = ang + (x.value / total) * Math.PI * 2
    ang = a1
    return { d: arc(a0 + 0.012, a1 - 0.012), color: x.color }
  })

  function onSlice(e: React.MouseEvent, i: number) {
    setHoverI(i)
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const x = items[i]
    show(
      e.clientX - rect.left,
      e.clientY - rect.top,
      <div>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{x.label}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontWeight: 700 }}>{fmt(x.value)}</span>
          <span style={{ color: '#c9cdd8' }}>{fmtPct(x.value / total)}</span>
        </div>
      </div>,
    )
  }
  function onLeave() {
    setHoverI(null)
    hide()
  }

  const svg = (
    <svg viewBox="0 0 200 200" style={{ width: embedded ? 150 : 190, height: embedded ? 150 : 190, flexShrink: 0 }}>
      {slices.map((s, i) => (
        <path
          key={i}
          className="nl-chart-donut"
          d={s.d}
          fill={s.color}
          style={{
            ['--nl-i' as string]: i,
            opacity: hoverI == null || hoverI === i ? 1 : 0.32,
            cursor: 'pointer',
            transition: 'opacity 0.15s ease',
          }}
          onMouseMove={(e) => onSlice(e, i)}
          onMouseLeave={onLeave}
        />
      ))}
      <text x="100" y="96" textAnchor="middle" fontSize="19" fontWeight="800" fill="#191c22" fontFamily="'Be Vietnam Pro', sans-serif">
        {fmtVND(total)}
      </text>
      <text x="100" y="114" textAnchor="middle" fontSize="10.5" fill="#9aa0ac" fontFamily="'Be Vietnam Pro', sans-serif">
        {centerLabel}
      </text>
    </svg>
  )

  const legend = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: embedded ? 9 : 11, flex: 1, minWidth: 0, width: embedded ? '100%' : undefined }}>
      {items.map((x, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            fontSize: embedded ? 12 : 12.5,
            opacity: hoverI == null || hoverI === i ? 1 : 0.5,
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={() => setHoverI(i)}
          onMouseLeave={() => setHoverI(null)}
        >
          <span style={{ width: 11, height: 11, borderRadius: 4, background: x.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, flex: 1 }}>{x.label}</span>
          {!embedded && (
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(x.value)}</span>
          )}
          <span style={{ color: '#6b7180', fontVariantNumeric: 'tabular-nums', width: embedded ? 46 : 52, textAlign: 'right' }}>
            {fmtPct(x.value / total)}
          </span>
        </div>
      ))}
    </div>
  )

  if (embedded) {
    return (
      <div ref={wrapRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {svg}
        {legend}
        <ChartTooltip tip={tip} containerW={wrapRef.current?.clientWidth} />
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        padding: '18px 20px',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>{sub}</div>
      <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 28, marginTop: 12 }}>
        {svg}
        {legend}
        <ChartTooltip tip={tip} containerW={wrapRef.current?.clientWidth} />
      </div>
    </div>
  )
}
