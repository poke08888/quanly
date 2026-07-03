import type { DashboardState } from '../../state/useDashboard'
import { SCREENS } from '../../state/roles'
import type { PlatformFilter } from '../../data/types'

const PLATFORM_BTNS: { id: PlatformFilter; label: string; dot: string; dotShow: boolean }[] = [
  { id: 'all', label: 'Toàn sàn', dot: 'transparent', dotShow: false },
  { id: 'tiktok', label: 'TikTok', dot: '#25f4ee', dotShow: true },
  { id: 'shopee', label: 'Shopee', dot: '#ee4d2d', dotShow: true },
]

export function Header({ s }: { s: DashboardState }) {
  const screen = SCREENS[s.screen]
  // The Orders (m7) page ignores the period filter (it lists the rolling recon window),
  // so the period selector + "compare" toggle are hidden there — they have no effect.
  const usesPeriod = s.screen !== 'm7'
  return (
    <div
      className="nl-header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'rgba(242,243,246,0.92)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #e6e8ee',
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ marginRight: 'auto' }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.015em' }}>
          {screen.title}
        </h1>
        <div style={{ fontSize: 12, color: '#7c828f', marginTop: 1 }}>{screen.sub}</div>
      </div>

      <select
        value={s.brand}
        onChange={(e) => s.setBrand(e.target.value)}
        style={selectStyle}
      >
        {s.brandOptions.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#e7e9ef', borderRadius: 10, padding: 3 }}>
        {PLATFORM_BTNS.map((p) => {
          const active = s.platform === p.id
          return (
            <button
              key={p.id}
              onClick={() => s.setPlatform(p.id)}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '6px 13px',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                background: active ? '#fff' : 'transparent',
                color: active ? '#191c22' : '#6b7180',
                boxShadow: active ? '0 1px 3px rgba(20,22,30,0.12)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {p.dotShow && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.dot }} />
              )}
              {p.label}
            </button>
          )
        })}
      </div>

      {usesPeriod && (
        <>
          <select value={s.periodId} onChange={(e) => s.setPeriodId(e.target.value)} style={selectStyle}>
            {s.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Tùy chỉnh…</option>
          </select>

          {s.periodId === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                value={s.customStart}
                max={s.customEnd}
                onChange={(e) => s.setCustomStart(e.target.value)}
                style={dateStyle}
              />
              <span style={{ color: '#9aa0ac', fontSize: 12 }}>→</span>
              <input
                type="date"
                value={s.customEnd}
                min={s.customStart}
                onChange={(e) => s.setCustomEnd(e.target.value)}
                style={dateStyle}
              />
            </div>
          )}

          <button
            onClick={s.toggleCompare}
            style={{
              border: `1px solid ${s.compare ? '#191c22' : '#d9dce4'}`,
              background: s.compare ? '#191c22' : '#fff',
              color: s.compare ? '#fff' : '#6b7180',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            So sánh kỳ trước
          </button>
        </>
      )}
    </div>
  )
}

const selectStyle = {
  border: '1px solid #d9dce4',
  background: '#fff',
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#22252c',
  cursor: 'pointer',
  outline: 'none',
} as const

const dateStyle = {
  border: '1px solid #d9dce4',
  background: '#fff',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#22252c',
  outline: 'none',
} as const
