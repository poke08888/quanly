// GMV / Chi phí / Lợi nhuận line chart — SVG, hand-rolled. Consumes pre-bucketed
// ChartPoint[] (hour/day/week/month) so granularity adapts to the selected period.
// Entry animation: lines draw in via stroke-dashoffset, area fades, dots pop.
// Hover: snap to nearest x-index → vertical guide + enlarged points + multi-series tooltip.
import { useRef, useState } from 'react'
import type { ChartPoint } from '../../lib/chartBuckets'
import { ChartTooltip, TipRow, useTooltip } from './ChartTooltip'

const VB_W = 1000
const VB_H = 280

export function LineChart({
  points,
  fmt,
  note,
}: {
  points: ChartPoint[]
  fmt: (v: number) => string
  note: string
}) {
  const ser = points
  const maxV = (Math.max(0, ...ser.map((s) => s.gmv)) || 1) * 1.1
  const X0 = 8
  const X1 = 992
  const Y0 = 14
  const Y1 = 252

  const px = (i: number) => X0 + (i / Math.max(ser.length - 1, 1)) * (X1 - X0)
  const py = (v: number) => Y1 - (v / maxV) * (Y1 - Y0)

  const path = (val: (p: ChartPoint) => number) =>
    ser
      .map((p, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(Math.max(val(p), 0)).toFixed(1))
      .join(' ')

  const gmvPath = path((p) => p.gmv)
  const costPath = path((p) => p.cost)
  const profitPath = path((p) => p.profit)
  const areaPath = gmvPath + ' L' + X1 + ',' + Y1 + ' L' + X0 + ',' + Y1 + ' Z'
  // Generous dash length so the draw-in reveal covers any real path length.
  const DASH = 2600

  const grid = [0.25, 0.5, 0.75, 1].map((f) => ({
    y: py(maxV * f).toFixed(1),
    ty: (py(maxV * f) - 5).toFixed(1),
    text: fmt(maxV * f),
  }))
  const n = ser.length
  const step = Math.max(1, Math.ceil(n / 12))
  const tickIdx: number[] = []
  for (let i = 0; i < n; i += step) tickIdx.push(i)
  if (tickIdx.length && tickIdx[tickIdx.length - 1] !== n - 1) tickIdx.push(n - 1)
  const xLabels = tickIdx.map((i) => ({
    x: px(i).toFixed(1),
    anchor: (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') as 'start' | 'end' | 'middle',
    text: ser[i] ? ser[i].label : '',
  }))

  // ----- hover -----
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const [hoverI, setHoverI] = useState<number | null>(null)

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current
    const wrap = wrapRef.current
    if (!svg || !wrap || n === 0) return
    const rect = svg.getBoundingClientRect()
    // Map cursor px -> viewBox x -> nearest data index.
    const vbX = ((e.clientX - rect.left) / rect.width) * VB_W
    const frac = (vbX - X0) / Math.max(X1 - X0, 1)
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))))
    setHoverI(i)
    const p = ser[i]
    const wrapRect = wrap.getBoundingClientRect()
    show(
      e.clientX - wrapRect.left,
      e.clientY - wrapRect.top,
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.label}</div>
        <TipRow color="#3d47d9" label="GMV" value={fmt(p.gmv)} />
        <TipRow color="#e8890c" label="Chi phí" value={fmt(p.cost)} />
        <TipRow color="#0f9d6b" label="Lợi nhuận" value={fmt(p.profit)} />
      </div>,
    )
  }
  function onLeave() {
    setHoverI(null)
    hide()
  }

  const hx = hoverI != null ? px(hoverI) : 0

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>Doanh thu · Chi phí · Lợi nhuận</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: '#6b7180' }}>
          <Legend color="#3d47d9" label="GMV" />
          <Legend color="#e8890c" label="Chi phí" />
          <Legend color="#0f9d6b" label="Lợi nhuận" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>{note}</div>
      <div ref={wrapRef} style={{ position: 'relative', marginTop: 10 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          {grid.map((g, i) => (
            <g key={i}>
              <line x1="0" x2="1000" y1={g.y} y2={g.y} stroke="#eef0f4" strokeWidth="1" />
              <text x="4" y={g.ty} fontSize="11" fill="#9aa0ac">
                {g.text}
              </text>
            </g>
          ))}
          {xLabels.map((x, i) => (
            <line key={`vg${i}`} x1={x.x} x2={x.x} y1="14" y2="252" stroke="#f4f5f8" strokeWidth="1" />
          ))}
          <path className="nl-chart-area" d={areaPath} fill="#3d47d9" opacity="0.06" />
          <path
            className="nl-chart-line"
            d={gmvPath}
            fill="none"
            stroke="#3d47d9"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeDasharray={DASH}
            strokeDashoffset={DASH}
          />
          <path
            className="nl-chart-line"
            d={costPath}
            fill="none"
            stroke="#e8890c"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeDasharray={DASH}
            strokeDashoffset={DASH}
            style={{ animationDelay: '0.1s' }}
          />
          <path
            className="nl-chart-line"
            d={profitPath}
            fill="none"
            stroke="#0f9d6b"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeDasharray={DASH}
            strokeDashoffset={DASH}
            style={{ animationDelay: '0.2s' }}
          />
          {ser.map((p, i) => (
            <circle
              key={`pt${i}`}
              className="nl-chart-dot"
              cx={px(i)}
              cy={py(Math.max(p.gmv, 0))}
              r={2.4}
              fill="#3d47d9"
              style={{ ['--nl-i' as string]: i }}
            />
          ))}

          {/* hover guide + enlarged series points */}
          {hoverI != null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={Y0} y2={Y1} stroke="#c3c8f5" strokeWidth="1.4" />
              <circle cx={hx} cy={py(Math.max(ser[hoverI].gmv, 0))} r={4.5} fill="#3d47d9" stroke="#fff" strokeWidth="1.5" />
              <circle cx={hx} cy={py(Math.max(ser[hoverI].cost, 0))} r={4} fill="#e8890c" stroke="#fff" strokeWidth="1.5" />
              <circle cx={hx} cy={py(Math.max(ser[hoverI].profit, 0))} r={4} fill="#0f9d6b" stroke="#fff" strokeWidth="1.5" />
            </g>
          )}

          {xLabels.map((x, i) => (
            <text key={i} x={x.x} y="276" fontSize="11" fill="#9aa0ac" textAnchor={x.anchor}>
              {x.text}
            </text>
          ))}
        </svg>
        <ChartTooltip tip={tip} containerW={wrapRef.current?.clientWidth} />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 3, borderRadius: 2, background: color }} />
      {label}
    </span>
  )
}
