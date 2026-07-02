// Bubble/scatter chart (SVG): x→horizontal, y→vertical (inverted), size→radius
// (sqrt-scaled, clamped 6–26px). Light gridlines + axis labels.
// Hover: bubble scales up + brightens + React tooltip with label & metrics.
import { useRef, useState } from 'react'
import { ChartTooltip, useTooltip } from './ChartTooltip'

export interface BubblePoint {
  x: number
  y: number
  size: number
  color: string
  label: string
}

export function BubbleChart({
  points,
  xLabel,
  yLabel,
  format,
  title,
  sub,
}: {
  points: BubblePoint[]
  xLabel: string
  yLabel: string
  format: (v: number) => string
  title?: string
  sub?: string
}) {
  const W = 420
  const H = 230
  const padL = 46
  const padR = 26
  const padT = 22
  const padB = 32
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const [hoverI, setHoverI] = useState<number | null>(null)

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const sizes = points.map((p) => p.size)
  const xMax = Math.max(...xs, 1)
  const yMax = Math.max(...ys, 1)
  const sMax = Math.max(...sizes, 1)
  const sMin = Math.min(...sizes, 0)

  const px = (x: number) => padL + (x / xMax) * plotW
  const py = (y: number) => padT + plotH - (y / yMax) * plotH
  const pr = (s: number) => {
    if (sMax <= sMin) return 10
    const t = (s - sMin) / (sMax - sMin)
    return 6 + t * 12 // 6..18px, spread across the actual value range
  }

  const gridN = 4
  const gy = Array.from({ length: gridN + 1 }, (_, i) => padT + (plotH / gridN) * i)
  const gx = Array.from({ length: gridN + 1 }, (_, i) => padL + (plotW / gridN) * i)

  function onBubble(e: React.MouseEvent, i: number) {
    setHoverI(i)
    const wrap = wrapRef.current
    const svg = svgRef.current
    if (!wrap || !svg) return
    const wrapRect = wrap.getBoundingClientRect()
    const p = points[i]
    show(
      e.clientX - wrapRect.left,
      e.clientY - wrapRect.top,
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.label}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#c9cdd8' }}>
            {xLabel}: <span style={{ fontWeight: 700, color: '#fff' }}>{format(p.x)}</span>
          </span>
          <span style={{ color: '#c9cdd8' }}>
            {yLabel}: <span style={{ fontWeight: 700, color: '#fff' }}>{format(p.y)}</span>
          </span>
          {p.size !== p.x && p.size !== p.y && (
            <span style={{ color: '#c9cdd8' }}>
              Quy mô: <span style={{ fontWeight: 700, color: '#fff' }}>{format(p.size)}</span>
            </span>
          )}
        </div>
      </div>,
    )
  }

  function onLeave() {
    setHoverI(null)
    hide()
  }

  return (
    <div ref={wrapRef} style={{ ...card, position: 'relative' }}>
      {title && <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>}
      {sub && <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>{sub}</div>}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 210, marginTop: title ? 10 : 0 }}
      >
        {/* gridlines */}
        {gy.map((y, i) => (
          <line key={`gy${i}`} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef0f4" strokeWidth={1} />
        ))}
        {gx.map((x, i) => (
          <line key={`gx${i}`} x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#f4f5f8" strokeWidth={1} />
        ))}
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#d9dce4" strokeWidth={1} />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#d9dce4" strokeWidth={1} />
        {/* points */}
        {points.map((p, i) => {
          const isHovered = hoverI === i
          const isDimmed = hoverI !== null && !isHovered
          const r = pr(p.size)
          return (
            <circle
              key={i}
              className="nl-chart-bubble"
              cx={px(p.x)}
              cy={py(p.y)}
              r={isHovered ? r * 1.35 : r}
              fill={p.color}
              fillOpacity={isDimmed ? 0.18 : isHovered ? 0.85 : 0.55}
              stroke={p.color}
              strokeWidth={isHovered ? 2 : 1}
              strokeOpacity={isDimmed ? 0.3 : 1}
              style={{
                ['--nl-i' as string]: i,
                cursor: 'pointer',
                transition: 'r 0.15s ease, fill-opacity 0.15s ease, stroke-opacity 0.15s ease, stroke-width 0.15s ease',
                filter: isHovered ? `drop-shadow(0 2px 6px ${p.color}55)` : 'none',
              }}
              onMouseMove={(e) => onBubble(e, i)}
              onMouseLeave={onLeave}
            />
          )
        })}
        {/* bubble labels on hover */}
        {hoverI !== null && (
          <text
            x={px(points[hoverI].x)}
            y={py(points[hoverI].y) - pr(points[hoverI].size) - 5}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#191c22"
            fontFamily="'Be Vietnam Pro', sans-serif"
            pointerEvents="none"
          >
            {points[hoverI].label}
          </text>
        )}
        {/* axis labels */}
        <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" fontSize="10.5" fill="#9aa0ac" fontFamily="'Be Vietnam Pro', sans-serif">
          {xLabel}
        </text>
        <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize="10.5" fill="#9aa0ac" transform={`rotate(-90 12 ${padT + plotH / 2})`} fontFamily="'Be Vietnam Pro', sans-serif">
          {yLabel}
        </text>
      </svg>
      <ChartTooltip tip={tip} containerW={wrapRef.current?.clientWidth} />
    </div>
  )
}

const card = {
  background: '#fff',
  border: '1px solid #e6e8ee',
  borderRadius: 13,
  padding: '18px 20px',
} as const
