import { useEffect, useState } from 'react'
import { syncCatalog } from '../data/costStore'
import type { DashboardState } from '../state/useDashboard'
import { PlatformBadge } from '../components/ui/PlatformBadge'
import { fmtInt, fmtPct } from '../lib/format'
import { fmtDayMonth } from '../lib/format'

/** One editable COGS row. Persists to the store on blur/Enter (Ops only). */
function CogsRow({
  sku,
  name,
  price,
  cost,
  canEdit,
  onSave,
}: {
  sku: string
  name: string
  price: number
  cost: number
  canEdit: boolean
  onSave: (cost: number) => void
}) {
  const [val, setVal] = useState(String(cost))
  // Keep the input in sync when the persisted value changes (after a save re-fetch).
  useEffect(() => setVal(String(cost)), [cost])
  const num = Number(val) || 0
  // Biên GỘP thuần sản xuất: (giá bán − giá vốn) / giá bán — không trừ phí sàn
  // (phí sàn có dòng riêng trong Cấu trúc GMV, tránh cảm giác COGS "dính" phí).
  const m = price > 0 ? (price - num) / price : 0
  const mColor = m >= 0.5 ? '#0f9d6b' : m >= 0.35 ? '#e8890c' : '#e5484d'
  const commit = () => {
    if (canEdit && num !== cost) onSave(num)
  }
  return (
    <div className="nl-trow" style={{ ...cogsGrid, ...cogsBody }}>
      <div style={{ fontSize: 11.5, color: '#7c828f' }}>{sku}</div>
      <div style={{ fontWeight: 600, fontSize: 12 }}>{name}</div>
      <div>
        <input
          type="number"
          value={val}
          disabled={!canEdit}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          style={{
            width: '100%',
            textAlign: 'right',
            border: '1px solid #d9dce4',
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: 12.5,
            fontVariantNumeric: 'tabular-nums',
            background: canEdit ? '#fff' : '#f4f5f8',
            outlineColor: '#3d47d9',
          }}
        />
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6b7180' }}>{fmtInt(price)}</div>
      <div style={{ textAlign: 'right', fontWeight: 700, color: mColor, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(m)}</div>
    </div>
  )
}

export function CostsM5({ s }: { s: DashboardState }) {
  const d = s.data
  const canEdit = s.canEdit
  const [bkCreator, setBkCreator] = useState('')
  const [bkCampaign, setBkCampaign] = useState('')
  const [bkPlatform, setBkPlatform] = useState<'tiktok' | 'shopee'>('tiktok')
  const [bkFee, setBkFee] = useState('')

  if (!d) return null
  const fmt = s.fmt

  const products = d.catalog.filter((p) => s.brand === 'group' || p.brand === s.brand)

  // Bookings come from the persisted cost store (already platform+brand filtered).
  const allBookings = d.bookings

  return (
    <div className="nl-fade">
      {!canEdit && (
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
          Bạn đang xem với quyền chỉ đọc. Chỉ vai trò Ops được nhập COGS và booking KOC.
        </div>
      )}

      <div className="nl-grid-2" style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14, alignItems: 'start' }}>
        {/* COGS */}
        <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, overflow: 'auto hidden' }}>
          <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>COGS theo SKU</div>
              <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>Giá vốn đơn vị — SKU thật từ kho đơn 2 sàn, nhập giá vốn để tính biên gộp (chưa trừ phí sàn)</div>
            </div>
            <button
              onClick={async () => {
                const r = await syncCatalog()
                alert(`Đồng bộ xong: +${r.added} SKU mới, ${r.updated} cập nhật / ${r.totalSkus} SKU từ sàn`)
                window.location.reload()
              }}
              style={{ border: '1px solid #d9dce4', borderRadius: 9, background: '#191c22', color: '#fff', fontSize: 12, fontWeight: 600, padding: '7px 13px', cursor: 'pointer' }}
            >
              ⟳ Lấy SKU từ sàn
            </button>
          </div>
          <div className="nl-trow" style={{ ...cogsGrid, ...headRow }}>
            <div>SKU</div>
            <div>Sản phẩm</div>
            <div style={{ textAlign: 'right' }}>Giá vốn (đ)</div>
            <div style={{ textAlign: 'right' }}>Giá bán</div>
            <div style={{ textAlign: 'right' }}>Biên gộp%</div>
          </div>
          {products.map((p) => (
            <CogsRow
              key={p.sku}
              sku={p.sku}
              name={p.name}
              price={p.price}
              cost={p.cost}
              canEdit={canEdit}
              onSave={(cost) => s.saveCogs(p.sku, cost)}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Booking KOC */}
          <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, overflow: 'auto hidden' }}>
            <div style={{ padding: '16px 20px 12px', fontSize: 13.5, fontWeight: 700 }}>Booking KOC (phí cố định)</div>
            {allBookings.map((b, i) => {
              const stFg = b.status === 'Đã ký' ? '#0f6b4c' : b.status === 'Hoàn thành' ? '#33418f' : '#8a5a12'
              const stBg = b.status === 'Đã ký' ? '#e3f5ec' : b.status === 'Hoàn thành' ? '#e9edfb' : '#fdf3e0'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', borderBottom: '1px solid #f4f5f8', fontSize: 12.5 }}>
                  <PlatformBadge platform={b.platform} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.creator}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#9aa0ac' }}>
                      {b.campaign} · {fmtDayMonth(b.date)}
                    </span>
                  </span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(b.fee)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: stFg, background: stBg, borderRadius: 6, padding: '3px 8px' }}>{b.status}</span>
                </div>
              )
            })}
            {canEdit && (
              <div className="nl-bkform" style={{ padding: '14px 20px', background: '#fafbfc', display: 'grid', gridTemplateColumns: '1.2fr 1fr 90px 110px auto', gap: 8, alignItems: 'center' }}>
                <input placeholder="Tên KOC" value={bkCreator} onChange={(e) => setBkCreator(e.target.value)} style={inp} />
                <input placeholder="Campaign" value={bkCampaign} onChange={(e) => setBkCampaign(e.target.value)} style={inp} />
                <select value={bkPlatform} onChange={(e) => setBkPlatform(e.target.value as 'tiktok' | 'shopee')} style={{ ...inp, background: '#fff' }}>
                  <option value="tiktok">TikTok</option>
                  <option value="shopee">Shopee</option>
                </select>
                <input type="number" placeholder="Phí (đ)" value={bkFee} onChange={(e) => setBkFee(e.target.value)} style={{ ...inp, textAlign: 'right' }} />
                <button
                  onClick={() => {
                    if (!bkCreator || !Number(bkFee)) return
                    s.addBooking({ creator: bkCreator, campaign: bkCampaign, platform: bkPlatform, fee: Number(bkFee) })
                    setBkCreator('')
                    setBkCampaign('')
                    setBkFee('')
                  }}
                  style={{ border: 'none', background: '#191c22', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  + Thêm
                </button>
              </div>
            )}
          </div>

          {/* Import CSV */}
          <div style={{ background: '#fff', border: '1px solid #e6e8ee', borderRadius: 13, padding: '16px 20px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Import KOC Shopee (CSV)</div>
            <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>Xuất từ Shopee Affiliate / AMS → tải lên tại đây</div>
            <div style={{ marginTop: 12, border: '1.5px dashed #c9cdd8', borderRadius: 11, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 12.5, color: '#6b7180' }}>Kéo thả tệp .csv vào đây hoặc</div>
              <button
                onClick={() => s.setImportDone(true)}
                disabled={!canEdit}
                style={{ marginTop: 8, border: '1px solid #d9dce4', background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Chọn tệp CSV
              </button>
              {s.importDone && (
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#0f9d6b', marginTop: 8 }}>
                  ✓ Đã nhập 128 dòng từ AMS_export_0107.csv — 9 KOC, 2.148 đơn
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const inp = { border: '1px solid #d9dce4', borderRadius: 8, padding: '7px 9px', fontSize: 12, outlineColor: '#3d47d9' } as const
const cogsGrid = { display: 'grid', gridTemplateColumns: '90px 1.5fr 110px 100px 80px', gap: 10 } as const
const headRow = {
  padding: '8px 20px',
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9aa0ac',
  borderBottom: '1px solid #eef0f4',
} as const
const cogsBody = { padding: '8px 20px', fontSize: 12.5, alignItems: 'center', borderBottom: '1px solid #f4f5f8' } as const
