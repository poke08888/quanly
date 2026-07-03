// M10 "Thương hiệu & Shop" — CEO-only. Add brands, attach TikTok/Shopee shops to a
// brand (1 brand : N shops), and configure each shop's credentials + sample/live mode.
// Credentials are write-only: the server returns only which fields are set (masked).
import { useState } from 'react'
import type { DashboardState } from '../state/useDashboard'
import {
  CRED_FIELDS,
  testShop,
  tiktokOAuthStartUrl,
  exchangeAuthCode,
  type BrandConfig,
  type ShopConfig,
  type ShopMode,
  type ShopPlatform,
} from '../data/brandShopStore'

const PLATFORMS: { key: ShopPlatform; label: string; color: string }[] = [
  { key: 'tiktok', label: 'TikTok', color: '#191c22' },
  { key: 'shopee', label: 'Shopee', color: '#ee4d2d' },
]

export function BrandsM10({ s }: { s: DashboardState }) {
  const [nName, setNName] = useState('')
  const brands = s.brands
  const shops = s.shops

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
        Mỗi thương hiệu có thể gắn <b>nhiều shop</b> TikTok/Shopee. Dữ liệu của một brand ={' '}
        <b>tổng các shop</b> của brand đó. Credential được <b>mã hoá</b> khi lưu và không bao giờ
        hiển thị lại (chỉ báo <b>✓ đã cấu hình</b>). Chọn <b>mode = live</b> để lấy dữ liệu thật.
      </div>

      {/* add-brand form */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e6e8ee',
          borderRadius: 13,
          padding: '14px 20px',
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input
          placeholder="Tên thương hiệu mới (VD: Nonelab)"
          value={nName}
          onChange={(e) => setNName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nName.trim()) {
              s.addBrand({ name: nName.trim() })
              setNName('')
            }
          }}
          style={inp}
        />
        <button
          onClick={() => {
            if (!nName.trim()) return
            s.addBrand({ name: nName.trim() })
            setNName('')
          }}
          style={btnDark}
        >
          + Thêm thương hiệu
        </button>
      </div>

      {brands.length === 0 && (
        <div style={{ padding: 30, color: '#9aa0ac', fontSize: 13, textAlign: 'center' }}>
          Chưa có thương hiệu nào. Thêm thương hiệu đầu tiên ở trên.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {brands.map((b) => (
          <BrandCard key={b.id} b={b} shops={shops.filter((sh) => sh.brandKey === b.key)} s={s} />
        ))}
      </div>
    </div>
  )
}

function BrandCard({ b, shops, s }: { b: BrandConfig; shops: ShopConfig[]; s: DashboardState }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        padding: '16px 18px',
        opacity: b.active ? 1 : 0.62,
      }}
    >
      {/* brand header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#191c22' }}>{b.name}</div>
          <div style={{ fontSize: 11.5, color: '#9aa0ac' }}>
            key: <code>{b.key}</code> · {shops.length} shop
          </div>
        </div>
        <label style={chk}>
          <input
            type="checkbox"
            checked={b.active}
            onChange={(e) => s.saveBrand(b.id, { active: e.target.checked })}
          />
          Hoạt động
        </label>
        <button
          onClick={() => {
            if (shops.length) {
              alert('Xoá hết shop của thương hiệu này trước khi xoá thương hiệu.')
              return
            }
            if (confirm(`Xoá thương hiệu "${b.name}"?`)) s.removeBrand(b.id)
          }}
          style={btnDanger}
        >
          Xoá brand
        </button>
      </div>

      {/* shops */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shops.map((sh) => (
          <ShopRow key={sh.id} sh={sh} s={s} />
        ))}
      </div>

      {/* add shop */}
      <AddShopForm brandKey={b.key} s={s} />
    </div>
  )
}

function ShopRow({ sh, s }: { sh: ShopConfig; s: DashboardState }) {
  const [open, setOpen] = useState(false)
  const fields = CRED_FIELDS[sh.platform]
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const platMeta = PLATFORMS.find((p) => p.key === sh.platform)!
  const configuredCount = Object.values(sh.configured).filter(Boolean).length

  // connection-test state (does not mutate persisted data / trigger reload)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  // manual auth_code exchange (fallback when redirect callback can't be used)
  const [showCode, setShowCode] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [exState, setExState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const [exMsg, setExMsg] = useState('')

  async function submitAuthCode() {
    if (!authCode.trim()) return
    setExState('busy')
    setExMsg('')
    const r = await exchangeAuthCode(sh.id, authCode.trim())
    setExState(r.ok ? 'ok' : 'error')
    setExMsg(r.message)
    if (r.ok) {
      setAuthCode('')
      s.reloadData()
    }
  }

  async function runTest() {
    setTestState('testing')
    setTestMsg('')
    const r = await testShop(sh.id)
    setTestState(r.ok ? 'ok' : 'error')
    setTestMsg(r.message)
    // Refresh the shop list so the persisted last-test status + time update.
    s.reloadData()
  }

  /** Open TikTok seller-authorization in a popup; reload when it reports back. */
  function connectTikTok() {
    const popup = window.open(tiktokOAuthStartUrl(sh.id), 'tiktok-oauth', 'width=580,height=740')
    const onMsg = (e: MessageEvent) => {
      if (e.data === 'tiktok-oauth-done') {
        window.removeEventListener('message', onMsg)
        s.reloadData()
      }
    }
    window.addEventListener('message', onMsg)
    // Fallback: poll for the popup closing (in case postMessage is blocked).
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer)
        window.removeEventListener('message', onMsg)
        s.reloadData()
      }
    }, 1000)
  }

  async function saveCreds() {
    const nonEmpty = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim() !== ''))
    await s.saveShop(sh.id, { credentials: nonEmpty })
    setCreds({})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ border: '1px solid #edeef3', borderRadius: 10, padding: '10px 12px', background: '#fafbfd' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={badge(platMeta.color, '#fff')}>{platMeta.label}</span>
        <StatusChip sh={sh} />
        {sh.autoRefresh && (
          <span style={badge('#eef1fb', '#33418f')} title="Có refresh token — tự động làm mới access token khi hết hạn">
            ⟳ auto-refresh
          </span>
        )}
        <input
          value={sh.name}
          onChange={(e) => s.saveShop(sh.id, { name: e.target.value })}
          style={{ ...inp, flex: '1 1 200px', padding: '6px 9px', fontSize: 12.5 }}
        />
        {/* mode toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['sample', 'live'] as ShopMode[]).map((m) => (
            <button
              key={m}
              onClick={() => s.saveShop(sh.id, { mode: m })}
              style={pill(sh.mode === m, m === 'live' ? '#0f9d6b' : '#6b7180')}
            >
              {m === 'live' ? 'LIVE (thật)' : 'sample'}
            </button>
          ))}
        </div>
        <label style={chk}>
          <input
            type="checkbox"
            checked={sh.active}
            onChange={(e) => s.saveShop(sh.id, { active: e.target.checked })}
          />
          Bật
        </label>
        <button onClick={() => setOpen((o) => !o)} style={btnGhost}>
          {open ? 'Ẩn credential' : `Credential (${configuredCount}/${fields.length})`}
        </button>
        {sh.platform === 'tiktok' && (
          <button
            onClick={connectTikTok}
            style={{ ...btnGhost, borderColor: '#191c22', color: '#191c22', fontWeight: 700 }}
            title="Ủy quyền shop qua TikTok để tự lấy access token, refresh token và shop_cipher"
          >
            🔗 Kết nối TikTok Shop
          </button>
        )}
        {sh.platform === 'tiktok' && (
          <button
            onClick={() => setShowCode((v) => !v)}
            style={btnGhost}
            title="Nếu nút Kết nối không tự điền token: dán auth_code thủ công"
          >
            {showCode ? 'Ẩn auth_code' : '⌨ Dán auth_code'}
          </button>
        )}
        <button
          onClick={runTest}
          disabled={testState === 'testing'}
          style={{ ...btnGhost, opacity: testState === 'testing' ? 0.6 : 1 }}
          title="Gọi thử API bằng credential của shop"
        >
          {testState === 'testing' ? 'Đang test…' : '⇄ Test kết nối'}
        </button>
        <button onClick={() => confirm(`Xoá shop "${sh.name}"?`) && s.removeShop(sh.id)} style={btnDanger}>
          Xoá
        </button>
      </div>

      {sh.mode === 'live' && configuredCount === 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: '#b3641e' }}>
          ⚠ Shop đang ở mode <b>live</b> nhưng chưa có credential — sẽ báo lỗi khi lấy dữ liệu.
        </div>
      )}

      {/* manual auth_code exchange (redirect-less fallback) */}
      {showCode && sh.platform === 'tiktok' && (
        <div style={{ marginTop: 10, padding: '11px 13px', border: '1px solid #d9dce4', borderRadius: 10, background: '#fafbfd' }}>
          <div style={{ fontSize: 12, color: '#33418f', marginBottom: 8, lineHeight: 1.55 }}>
            <b>Cách lấy auth_code:</b> mở{' '}
            <a href={tiktokOAuthStartUrl(sh.id)} target="_blank" rel="noreferrer" style={{ color: '#3d47d9', fontWeight: 700 }}>
              trang ủy quyền
            </a>{' '}
            (cần App Key + App Secret + Service ID đã lưu) → Authorize shop → trình duyệt nhảy sang 1 URL,
            trên thanh địa chỉ có đoạn <code>?code=XXXX</code> hoặc <code>&code=XXXX</code>. Copy đúng phần{' '}
            <b>XXXX</b> (sau <code>code=</code>) rồi dán vào đây. Mã hết hạn nhanh — làm ngay.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Dán auth_code ở đây"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitAuthCode()}
              style={{ ...inp, flex: '1 1 260px', padding: '8px 10px', fontSize: 12.5 }}
            />
            <button onClick={submitAuthCode} disabled={exState === 'busy'} style={{ ...btnPrimary, opacity: exState === 'busy' ? 0.6 : 1 }}>
              {exState === 'busy' ? 'Đang đổi…' : 'Đổi lấy token + cipher'}
            </button>
          </div>
          {exState !== 'idle' && exState !== 'busy' && (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: exState === 'ok' ? '#0f6b4c' : '#b3261e' }}>
              {exState === 'ok' ? '✓ ' : '✗ '}{exMsg}
            </div>
          )}
        </div>
      )}

      {/* persisted last-test line (hidden while a fresh result box is showing) */}
      {testState === 'idle' && sh.lastTestAt && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: '#8a909c' }}>
          Kiểm tra gần nhất: <b style={{ color: sh.lastTestOk ? '#0f6b4c' : '#b3261e' }}>
            {sh.lastTestOk ? '✓ OK' : '✗ Lỗi'}
          </b>{' '}
          · {fmtTime(sh.lastTestAt)}
          {sh.lastTestMsg && !sh.lastTestOk && (
            <span title={sh.lastTestMsg}> · {sh.lastTestMsg.slice(0, 80)}{sh.lastTestMsg.length > 80 ? '…' : ''}</span>
          )}
        </div>
      )}

      {testState !== 'idle' && testState !== 'testing' && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            fontWeight: 500,
            padding: '7px 11px',
            borderRadius: 8,
            border: `1px solid ${testState === 'ok' ? '#bfe6d4' : '#f3c8c8'}`,
            background: testState === 'ok' ? '#eafaf2' : '#fdf1f1',
            color: testState === 'ok' ? '#0f6b4c' : '#b3261e',
            wordBreak: 'break-word',
          }}
        >
          {testState === 'ok' ? '✓ ' : '✗ '}
          {testMsg}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #edeef3' }}>
          {sh.platform === 'tiktok' && (
            <div style={{ marginBottom: 10, fontSize: 11.5, color: '#33418f', background: '#eef1fb', border: '1px solid #ccd4f0', borderRadius: 8, padding: '8px 11px' }}>
              <b>Kết nối tự động:</b> chỉ cần nhập <b>App Key</b>, <b>App Secret</b>, <b>Service ID</b> rồi bấm{' '}
              <b>🔗 Kết nối TikTok Shop</b> — access/refresh token + shop_cipher sẽ tự điền. Trong TikTok Partner Center,
              đăng ký <b>Redirect URL</b> của app là:{' '}
              <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 4 }}>
                {location.origin}/api/tiktok/oauth/callback
              </code>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {fields.map((f) => (
              <div key={f.key}>
                <div style={labelCap}>
                  {f.label} {sh.configured[f.key] && <span style={{ color: '#0f9d6b' }}>✓ đã cấu hình</span>}
                </div>
                <input
                  type={f.secret ? 'password' : 'text'}
                  placeholder={sh.configured[f.key] ? '•••••• (để trống = giữ nguyên)' : 'chưa cấu hình'}
                  value={creds[f.key] ?? ''}
                  onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                  style={{ ...inp, width: '100%', padding: '7px 9px', fontSize: 12 }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={saveCreds} style={btnPrimary}>
              Lưu credential
            </button>
            {saved && <span style={{ fontSize: 12, fontWeight: 600, color: '#0f9d6b' }}>✓ Đã lưu (mã hoá)</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function AddShopForm({ brandKey, s }: { brandKey: string; s: DashboardState }) {
  const [platform, setPlatform] = useState<ShopPlatform>('tiktok')
  const [name, setName] = useState('')

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px dashed #e2e4ec',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ ...labelCap, marginBottom: 0 }}>Thêm shop:</span>
      <select value={platform} onChange={(e) => setPlatform(e.target.value as ShopPlatform)} style={{ ...inp, background: '#fff', padding: '7px 9px', fontSize: 12 }}>
        {PLATFORMS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      <input
        placeholder="Tên shop (VD: Nonelab Official Store)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ ...inp, flex: '1 1 220px', padding: '7px 9px', fontSize: 12.5 }}
      />
      <button
        onClick={() => {
          if (!name.trim()) return
          s.addShop({ brandKey, platform, name: name.trim(), mode: 'sample' })
          setName('')
        }}
        style={btnDark}
      >
        + Gắn shop
      </button>
    </div>
  )
}

/** Compact connection-status dot: reflects mode + persisted last-test result. */
function StatusChip({ sh }: { sh: ShopConfig }) {
  if (sh.mode === 'sample') return <span style={badge('#f1f2f6', '#8a909c')}>sample</span>
  if (sh.lastTestOk === true) return <span style={badge('#e3f5ec', '#0f6b4c')}>● Kết nối OK</span>
  if (sh.lastTestOk === false) return <span style={badge('#fdeaea', '#b3261e')}>● Lỗi kết nối</span>
  return <span style={badge('#fef4e6', '#b3641e')}>○ Chưa test</span>
}

/** "HH:MM DD/MM" from an ISO timestamp (local time). */
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`
}

// ---- shared styles (matched to UsersM8) ----
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

const chk = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#4c5160',
  cursor: 'pointer',
} as const

const btnDark = {
  border: 'none',
  background: '#191c22',
  color: '#fff',
  borderRadius: 8,
  padding: '9px 16px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
} as const

const btnPrimary = {
  border: 'none',
  background: '#3d47d9',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
} as const

const btnGhost = {
  border: '1px solid #d9dce4',
  background: '#fff',
  color: '#4c5160',
  borderRadius: 8,
  padding: '6px 11px',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
} as const

const btnDanger = {
  border: '1px solid #f3c8c8',
  background: '#fdf1f1',
  color: '#b3261e',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} as const

function badge(bg: string, fg: string) {
  return { fontSize: 11, fontWeight: 700, color: fg, background: bg, borderRadius: 6, padding: '3px 9px' } as const
}

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
