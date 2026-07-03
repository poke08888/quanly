// Funnel — center-aligned bars that taper downward (real funnel silhouette).
// Bar WIDTH is sqrt-scaled + floored for readability (extreme drop-offs like
// impressions→conversions would otherwise be invisible); the exact numbers live
// in each bar and the "▼ <rate>" between stages carries the true conversion.
// Hover: bar brightens + scale + tooltip with exact value & conversion rate.
import { Fragment, useState } from 'react'
import { fmtPct } from '../../lib/format'

export interface FunnelStage {
  label: string
  value: number
  color: string
}

export function Funnel({
  stages,
  format,
  title,
  sub,
}: {
  stages: FunnelStage[]
  format: (v: number) => string
  title?: string
  sub?: string
}) {
  const first = stages[0]?.value || 1
  const [hoverI, setHoverI] = useState<number | null>(null)

  return (
    <div style={card}>
      {title && <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>}
      {sub && <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>{sub}</div>}
      <div style={{ marginTop: title ? 18 : 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {stages.map((st, i) => {
          const prev = stages[i - 1]
          const rate = prev && prev.value ? st.value / prev.value : null
          const overallRate = st.value / first
          // visual width: sqrt so small stages stay visible, floor 26% so labels fit
          const wPct = Math.max(Math.sqrt(st.value / first) * 100, 26)
          const isHovered = hoverI === i
          const isDimmed = hoverI !== null && !isHovered
          return (
            <Fragment key={i}>
              {rate != null && (
                <div style={{ fontSize: 11, color: '#8a909c', fontWeight: 600, padding: '6px 0' }}>
                  ▼ {fmtPct(rate)}
                </div>
              )}
              <div
                className="nl-chart-funnel"
                style={{
                  width: `${wPct}%`,
                  minWidth: 150,
                  height: 52,
                  background: st.color,
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  lineHeight: 1.2,
                  cursor: 'pointer',
                  ['--nl-i' as string]: i,
                  opacity: isDimmed ? 0.45 : 1,
                  filter: isHovered ? 'brightness(1.15) drop-shadow(0 4px 12px rgba(0,0,0,0.22))' : 'none',
                  transform: isHovered ? 'scaleY(1.06)' : 'none',
                  transition: 'opacity 0.15s ease, filter 0.15s ease, transform 0.15s ease',
                }}
                onMouseEnter={() => setHoverI(i)}
                onMouseLeave={() => setHoverI(null)}
                title={`${st.label}: ${format(st.value)}${i > 0 ? ` (${fmtPct(overallRate)} so ban đầu)` : ''}`}
              >
                <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>{st.label}</span>
                <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{format(st.value)}</span>
              </div>
              {/* Hover info bar */}
              {isHovered && (
                <div
                  style={{
                    marginTop: 6,
                    background: '#191c22',
                    color: '#fff',
                    borderRadius: 7,
                    padding: '5px 12px',
                    fontSize: 11,
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                    pointerEvents: 'none',
                    animation: 'nlFadeIn 0.15s ease',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{format(st.value)}</span>
                  {i > 0 && (
                    <span style={{ color: '#c9cdd8' }}>
                      {fmtPct(overallRate)} so ban đầu
                    </span>
                  )}
                  {rate != null && (
                    <span style={{ color: '#c9cdd8' }}>
                      CR từ trước: <span style={{ color: rate >= 0.5 ? '#34d399' : rate >= 0.2 ? '#fbbf24' : '#f87171', fontWeight: 700 }}>{fmtPct(rate)}</span>
                    </span>
                  )}
                </div>
              )}
            </Fragment>
          )
        })}
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
