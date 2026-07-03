import { useState } from 'react'
import { C } from '../lib/tokens'

/** Full-screen login gate. Submits email + password to the session API. */
export function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await onLogin(email.trim(), password)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setBusy(false)
    }
  }

  const field: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13.5,
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    outline: 'none',
    marginTop: 6,
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.bg,
      }}
    >
      <form
        onSubmit={submit}
        className="nl-fade"
        style={{
          width: 360,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 15,
          padding: '28px 26px',
          boxShadow: '0 8px 30px rgba(25,28,34,0.06)',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>Nonelab Group</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>Báo cáo vận hành đa sàn</div>

        <div style={{ marginTop: 22 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>Email</label>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={field}
            placeholder="you@nonelab.net"
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>Mật khẩu</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={field}
            placeholder="••••••••"
          />
        </div>

        {err && <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>{err}</div>}

        <button
          type="submit"
          disabled={busy || !email || !password}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '11px 12px',
            fontSize: 14,
            fontWeight: 700,
            color: '#fff',
            background: busy ? C.muted2 : C.indigo,
            border: 'none',
            borderRadius: 9,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
