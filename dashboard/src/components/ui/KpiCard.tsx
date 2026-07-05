import type { DeltaChip } from '../../lib/deltaChip'

// M1-style KPI card (top accent bar + delta chip).
export function KpiCard({
  label,
  value,
  accent,
  sub,
  valColor,
  delta,
}: {
  label: string
  value: string
  accent: string
  sub?: string
  valColor?: string
  delta?: DeltaChip
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderTop: `3px solid ${accent}`,
        borderRadius: 13,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#7c828f' }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums',
          color: valColor || '#191c22',
        }}
      >
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 5 }}>
        {delta?.show && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: delta.deltaColor }}>
            {delta.delta}
          </span>
        )}
        <span style={{ fontSize: 10.5, color: '#9aa0ac' }}>{sub || 'so với kỳ trước'}</span>
      </div>
    </div>
  )
}

// Plain KPI card used by M3/M4/M6 (no accent bar).
export function StatCard({
  label,
  value,
  sub,
  valColor,
  delta,
}: {
  label: string
  value: string | number
  sub?: string
  valColor?: string
  delta?: DeltaChip
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#7c828f' }}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums',
          color: valColor || '#191c22',
        }}
      >
        {value}
      </div>
      {(sub != null || delta?.show) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          {delta?.show && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: delta.deltaColor }}>{delta.delta}</span>
          )}
          {sub != null && <span style={{ fontSize: 10.5, color: '#9aa0ac' }}>{sub}</span>}
        </div>
      )}
    </div>
  )
}
