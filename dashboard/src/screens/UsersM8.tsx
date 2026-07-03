// M8 "Quản lý user" — CEO-only. Grant each user which platforms (sàn) and which
// channels (kênh/nguồn) they may view. Persisted via the BFF user store.
import { useState } from 'react'
import type { DashboardState } from '../state/useDashboard'
import type { User, UserChannel, UserPlatform, UserRole } from '../data/userStore'

const PLATFORMS: { key: UserPlatform; label: string; color: string }[] = [
  { key: 'tiktok', label: 'TikTok', color: '#191c22' },
  { key: 'shopee', label: 'Shopee', color: '#ee4d2d' },
]
const CHANNELS: { key: UserChannel; label: string }[] = [
  { key: 'live', label: 'LIVE' },
  { key: 'video', label: 'Video' },
  { key: 'card', label: 'Thẻ sản phẩm' },
  { key: 'search', label: 'Tìm kiếm' },
]
const ROLE_LABELS: Record<UserRole, string> = { ceo: 'CEO', bm: 'Brand Manager', ops: 'Ops' }

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export function UsersM8({ s }: { s: DashboardState }) {
  const d = s.data
  const [nName, setNName] = useState('')
  const [nEmail, setNEmail] = useState('')
  const [nRole, setNRole] = useState<UserRole>('bm')
  if (!d) return null
  const users = d.users

  return (
    <div className="nl-fade">
      <div
        style={{
          background: '#eef1fb',
          border: '1px solid #ccd4f0',
          borderRadius: 12,
          padding: '10px 16px',
          marginBottom: 14,
          fontSize: 12.5,
          color: '#33418f',
        }}
      >
        Phân quyền được lưu vào hệ thống. Việc áp dụng khi xem (giới hạn toggle sàn ở Header theo
        quyền của user) sẽ triển khai ở bước sau.
        {/* TODO wire enforcement: limit Header platform toggle + channel views to the
            signed-in user's allowed platforms/channels once real auth exists. */}
      </div>

      {/* add-user form */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e6e8ee',
          borderRadius: 13,
          padding: '14px 20px',
          marginBottom: 14,
          display: 'grid',
          gridTemplateColumns: '1.4fr 1.6fr 130px auto',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input placeholder="Họ tên" value={nName} onChange={(e) => setNName(e.target.value)} style={inp} />
        <input placeholder="Email" value={nEmail} onChange={(e) => setNEmail(e.target.value)} style={inp} />
        <select value={nRole} onChange={(e) => setNRole(e.target.value as UserRole)} style={{ ...inp, background: '#fff' }}>
          <option value="ceo">CEO</option>
          <option value="bm">Brand Manager</option>
          <option value="ops">Ops</option>
        </select>
        <button
          onClick={() => {
            if (!nName || !nEmail) return
            s.addUser({ name: nName, email: nEmail, role: nRole })
            setNName('')
            setNEmail('')
            setNRole('bm')
          }}
          style={{ border: 'none', background: '#191c22', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          + Thêm user
        </button>
      </div>

      {/* user cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {users.map((u) => (
          <UserRow key={u.id} u={u} s={s} />
        ))}
      </div>
    </div>
  )
}

function UserRow({ u, s }: { u: User; s: DashboardState }) {
  const [pw, setPw] = useState('')
  const [pwState, setPwState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [pwErr, setPwErr] = useState('')

  async function submitPassword() {
    if (pw.length < 6) {
      setPwState('error')
      setPwErr('Mật khẩu tối thiểu 6 ký tự')
      return
    }
    setPwState('saving')
    setPwErr('')
    try {
      await s.setUserPassword(u.id, pw)
      setPw('')
      setPwState('ok')
      setTimeout(() => setPwState('idle'), 2500)
    } catch {
      setPwState('error')
      setPwErr('Không đặt được mật khẩu — thử lại')
    }
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        padding: '14px 18px',
        opacity: u.active ? 1 : 0.62,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* identity */}
        <div style={{ minWidth: 210, flex: '1 1 210px' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#191c22' }}>{u.name}</div>
          <div style={{ fontSize: 11.5, color: '#9aa0ac' }}>{u.email}</div>
        </div>

        {/* role */}
        <div>
          <div style={labelCap}>Vai trò</div>
          <select
            value={u.role}
            onChange={(e) => s.saveUser(u.id, { role: e.target.value as UserRole })}
            style={{ ...inp, background: '#fff', padding: '6px 8px', fontSize: 12 }}
          >
            {(['ceo', 'bm', 'ops'] as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        {/* platforms */}
        <div>
          <div style={labelCap}>Sàn được xem</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {PLATFORMS.map((p) => {
              const on = u.platforms.includes(p.key)
              return (
                <button
                  key={p.key}
                  onClick={() => s.saveUser(u.id, { platforms: toggle(u.platforms, p.key) })}
                  style={pill(on, on ? p.color : undefined)}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* channels */}
        <div style={{ flex: '1 1 auto' }}>
          <div style={labelCap}>Kênh được xem</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHANNELS.map((c) => {
              const on = u.channels.includes(c.key)
              return (
                <button
                  key={c.key}
                  onClick={() => s.saveUser(u.id, { channels: toggle(u.channels, c.key) })}
                  style={pill(on, on ? '#3d47d9' : undefined)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* active + delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4c5160', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={u.active}
              onChange={(e) => s.saveUser(u.id, { active: e.target.checked })}
            />
            Hoạt động
          </label>
          <button
            onClick={() => s.removeUser(u.id)}
            title="Xoá user"
            style={{ border: '1px solid #f3c8c8', background: '#fdf1f1', color: '#b3261e', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Xoá
          </button>
        </div>
      </div>

      {/* password control */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid #f4f5f8',
        }}
      >
        <span style={labelCap}>Mật khẩu đăng nhập</span>
        {u.hasPassword ? (
          <span style={badge('#e3f5ec', '#0f6b4c')}>● Đã đặt mật khẩu</span>
        ) : (
          <span style={badge('#f1f2f6', '#8a909c')}>○ Chưa đặt</span>
        )}
        <input
          type="password"
          placeholder="Mật khẩu mới (≥ 6 ký tự)"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value)
            if (pwState !== 'idle') setPwState('idle')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitPassword()
          }}
          style={{ ...inp, width: 220, padding: '7px 9px', fontSize: 12 }}
        />
        <button
          onClick={submitPassword}
          disabled={pwState === 'saving'}
          style={{
            border: 'none',
            background: '#3d47d9',
            color: '#fff',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 700,
            cursor: pwState === 'saving' ? 'default' : 'pointer',
            opacity: pwState === 'saving' ? 0.7 : 1,
          }}
        >
          {pwState === 'saving' ? 'Đang lưu…' : 'Đặt lại mật khẩu'}
        </button>
        {pwState === 'ok' && <span style={{ fontSize: 12, fontWeight: 600, color: '#0f9d6b' }}>✓ Đã lưu</span>}
        {pwState === 'error' && <span style={{ fontSize: 12, fontWeight: 600, color: '#e5484d' }}>{pwErr}</span>}
      </div>
    </div>
  )
}

function badge(bg: string, fg: string) {
  return {
    fontSize: 11,
    fontWeight: 600,
    color: fg,
    background: bg,
    borderRadius: 6,
    padding: '3px 8px',
  } as const
}

const inp = {
  border: '1px solid #d9dce4',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12.5,
  outlineColor: '#3d47d9',
} as const

const labelCap = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9aa0ac',
  marginBottom: 5,
} as const

function pill(on: boolean, color?: string) {
  return {
    border: `1px solid ${on ? color ?? '#3d47d9' : '#d9dce4'}`,
    background: on ? color ?? '#3d47d9' : '#fff',
    color: on ? '#fff' : '#6b7180',
    borderRadius: 999,
    padding: '5px 11px',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
  } as const
}
