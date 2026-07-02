// Horizontal bar chart — label + proportional bar + formatted value. Rows render
// in the order passed (caller sorts). Wrapped in a standard card. Entry animation:
// bars grow from the left. Hover: row highlight + tooltip with the exact value.
import { useRef, useState } from 'react'
import { ChartTooltip, useTooltip } from './ChartTooltip'

export interface HBarItem {
  label: string
  value: number
  color: string
}

export function HBarChart({
  items,
  format,
  title,
  sub,
}: {
  items: HBarItem[]
  format: (v: number) => string
  title?: string
  sub?: string
}) {
  const max = items.reduce((m, x) => Math.max(m, x.value), 0) || 1
  const wrapRef = useRef<HTMLDivElement>(null)
  const { tip, show, hide } = useTooltip()
  const [hoverI, setHoverI] = useState<number | null>(null)

  function onRow(e: React.MouseEvent, i: number) {
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
        <div style={{ fontWeight: 700 }}>{format(x.value)}</div>
      </div>,
    )
  }

  return (
    <div style={card}>
      {title && <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>}
      {sub && <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>{sub}</div>}
      <div ref={wrapRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 9, marginTop: title ? 14 : 0 }}>
        {items.map((x, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12.5,
              padding: '2px 4px',
              margin: '-2px -4px',
              borderRadius: 6,
              background: hoverI === i ? '#f4f5f8' : 'transparent',
              transition: 'background 0.12s ease',
              cursor: 'default',
            }}
            onMouseMove={(e) => onRow(e, i)}
            onMouseLeave={() => {
              setHoverI(null)
              hide()
            }}
          >
            <span
              style={{
                width: '40%',
                flexShrink: 0,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={x.label}
            >
              {x.label}
            </span>
            <span style={{ flex: 1, minWidth: 0, background: '#eef0f4', borderRadius: 5, height: 16 }}>
              <span
                className="nl-chart-barx"
                style={{
                  display: 'block',
                  height: '100%',
                  width: `${Math.max((x.value / max) * 100, 1.5)}%`,
                  background: x.color,
                  borderRadius: 5,
                  ['--nl-i' as string]: i,
                }}
              />
            </span>
            <span
              style={{
                width: 68,
                textAlign: 'right',
                flexShrink: 0,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {format(x.value)}
            </span>
          </div>
        ))}
        <ChartTooltip tip={tip} containerW={wrapRef.current?.clientWidth} />
      </div>
    </div>
  )
}

const card = {
  background: '#fff',
  border: '1px solid #e6e8ee',
  borderRadius: 13,
  padding: '18px 20px',
} as const
