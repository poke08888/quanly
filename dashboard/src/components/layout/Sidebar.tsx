import type { DashboardState } from '../../state/useDashboard'
import { ROLE_META, SCREEN_ICONS, SCREENS } from '../../state/roles'

export function Sidebar({ s }: { s: DashboardState }) {
  return (
    <aside
      className="nl-sidebar"
      style={{
        width: 228,
        flexShrink: 0,
        background: '#ffffff',
        borderRight: '1px solid #e6e8ee',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 14px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 18px' }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: '#191c22',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: 17,
          }}
        >
          N
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Nonelab Group</div>
          <div style={{ fontSize: 11, color: '#868c99' }}>Báo cáo vận hành đa sàn</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {s.allowed.map((id) => {
          const active = id === s.screen
          return (
            <button
              key={id}
              onClick={() => {
                s.setScreen(id)
                s.setExpandedOrder(null)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                border: 'none',
                borderRadius: 9,
                background: active ? '#191c22' : 'transparent',
                color: active ? '#fff' : '#4c5160',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <span style={{ display: 'inline-flex', width: 18, opacity: 0.85 }}>{SCREEN_ICONS[id]}</span>
              {SCREENS[id].label}
            </button>
          )
        })}
      </nav>

      <div style={{ marginTop: 'auto', borderTop: '1px solid #eef0f4', paddingTop: 12 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#9aa0ac',
            padding: '0 8px 8px',
          }}
        >
          Vai trò
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ROLE_META.map((r) => {
            const active = s.role === r.id
            return (
              <button
                key={r.id}
                onClick={() => s.setRole(r.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '8px 10px',
                  border: `1px solid ${active ? '#191c22' : '#e6e8ee'}`,
                  borderRadius: 9,
                  background: active ? '#f7f8fa' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: active ? '#191c22' : '#eceef2',
                    color: active ? '#fff' : '#6b7180',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {r.initial}
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#22252c' }}>
                    {r.label}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: '#8a909c' }}>{r.desc}</span>
                </span>
              </button>
            )
          })}
        </div>

        {s.authUser && (
          <div style={{ marginTop: 12, borderTop: '1px solid #eef0f4', paddingTop: 10 }}>
            <div style={{ padding: '0 8px', overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#22252c', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {s.authUser.name}
              </div>
              <div style={{ fontSize: 10.5, color: '#8a909c', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {s.authUser.email}
              </div>
            </div>
            <button
              onClick={() => s.logout()}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '7px 10px',
                border: '1px solid #e6e8ee',
                borderRadius: 9,
                background: '#fff',
                color: '#e5484d',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Đăng xuất
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
