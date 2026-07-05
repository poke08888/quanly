// TikTok "Phân tích GMV" — rich GMV-by-source panel (Seller Center style).
// Shown on M1 only when platform === 'tiktok'. Left: donut + legend. Right:
// expandable per-source rows; LIVE/Video expand into Liên kết (affiliate) /
// Người bán (seller) sub-rows.

import { useState } from 'react'
import type { Sources } from '../../data/types'
import { Donut, type DonutItem } from './Donut'
import { fmtPct } from '../../lib/format'
import { SOURCE_COLORS, SOURCE_LABELS } from '../../lib/tokens'

type SourceKey = keyof Sources // 'live' | 'video' | 'card' | 'search'

// Deterministic affiliate(Liên kết) / seller(Người bán) split per source. These
// ratios are synthesized — the sources are 0 in the live API path today.
// TODO the real affiliate/seller split needs a TikTok source-attribution endpoint;
// once available, replace this synthesis with the reported sub-channel GMV.
const SPLIT: Record<SourceKey, { affiliate: number; seller: number }> = {
  live: { affiliate: 0.15, seller: 0.85 },
  video: { affiliate: 0.88, seller: 0.12 },
  card: { affiliate: 0, seller: 1 },
  search: { affiliate: 0, seller: 1 },
}

const EXPANDABLE: SourceKey[] = ['live', 'video']

/** Pure helper: split a source's GMV into affiliate/seller sub-channels. */
export function splitSource(key: SourceKey, gmv: number): { affiliate: number; seller: number } {
  const r = SPLIT[key]
  return { affiliate: gmv * r.affiliate, seller: gmv * r.seller }
}

function deltaPct(cur: number, prev: number): { text: string; color: string; show: boolean } {
  if (!prev) return { text: '', color: '#9aa0ac', show: false }
  const ch = (cur - prev) / Math.abs(prev)
  const up = ch >= 0
  return {
    text: (up ? '▲ +' : '▼ −') + Math.abs(ch * 100).toFixed(1).replace('.', ',') + '%',
    color: up ? '#0f9d6b' : '#e5484d',
    show: true,
  }
}

export function GmvSourceBreakdown({
  sources,
  prevSources,
  fmt,
}: {
  sources: Sources
  prevSources: Sources
  fmt: (v: number) => string
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ live: true, video: true })
  const [view, setView] = useState<'content' | 'order'>('content')
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const keys = (['live', 'video', 'card', 'search', 'affiliate'] as SourceKey[]).filter((k) => sources[k] > 0)
  const total = keys.reduce((s, k) => s + sources[k], 0) || 1

  const donutItems: DonutItem[] = keys.map((k) => ({
    label: SOURCE_LABELS[k],
    value: sources[k],
    color: SOURCE_COLORS[k],
  }))

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        padding: '18px 20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Phân tích GMV</div>
          <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2, maxWidth: 420 }}>
            Dữ liệu dựa trên loại nội dung cuối cùng người dùng tương tác trước khi đặt hàng.
          </div>
        </div>
        {/* segmented toggle */}
        <div style={{ display: 'flex', background: '#f1f2f6', borderRadius: 8, padding: 2, flexShrink: 0 }}>
          {(['content', 'order'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                border: 'none',
                background: view === v ? '#fff' : 'transparent',
                boxShadow: view === v ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                color: view === v ? '#191c22' : '#7c828f',
                borderRadius: 6,
                padding: '5px 10px',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {v === 'content' ? 'Theo loại nội dung' : 'Theo nguồn đơn hàng'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 16, marginTop: 14, alignItems: 'start' }}>
        {/* LEFT: donut + legend */}
        <div>
          <Donut title="" sub="" items={donutItems} fmt={fmt} embedded />
        </div>

        {/* RIGHT: expandable rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {view === 'order' && (
            <div
              style={{
                fontSize: 11.5,
                color: '#8a5a12',
                background: '#fdf3e0',
                border: '1px solid #f2e0bd',
                borderRadius: 8,
                padding: '7px 10px',
                marginBottom: 8,
              }}
            >
              Phân tích theo nguồn đơn hàng đang cập nhật — hiển thị số liệu theo loại nội dung.
            </div>
          )}
          {keys.map((k) => {
            const val = sources[k]
            const canExpand = EXPANDABLE.includes(k)
            const open = canExpand && expanded[k]
            const d = deltaPct(val, prevSources[k])
            const sub = splitSource(k, val)
            const subPrev = splitSource(k, prevSources[k])
            const isH = hoverKey === k
            return (
              <div key={k}>
                <div
                  onClick={() => canExpand && setExpanded((p) => ({ ...p, [k]: !p[k] }))}
                  onMouseEnter={() => setHoverKey(k)}
                  onMouseLeave={() => setHoverKey(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    fontSize: 12.5,
                    padding: '9px 8px',
                    margin: '0 -8px',
                    borderBottom: '1px solid #f4f5f8',
                    cursor: canExpand ? 'pointer' : 'default',
                    background: isH ? '#f7f8ff' : 'transparent',
                    borderRadius: isH ? 8 : 0,
                    transition: 'background 0.12s ease',
                  }}
                >
                  <span style={{ width: 11, height: 11, borderRadius: 4, background: SOURCE_COLORS[k], flexShrink: 0, transition: 'transform 0.12s ease', transform: isH ? 'scale(1.25)' : 'none' }} />
                  <span style={{ fontWeight: 600 }}>{SOURCE_LABELS[k]}</span>
                  <span style={{ fontSize: 11, color: '#9aa0ac' }}>Xem phân tích</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(val)}</span>
                  <span style={{ color: '#6b7180', fontVariantNumeric: 'tabular-nums', width: 46, textAlign: 'right' }}>
                    {fmtPct(val / total)}
                  </span>
                  <span style={{ color: d.color, fontWeight: 700, fontSize: 11, width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {d.show ? d.text : '—'}
                  </span>
                  <span style={{ width: 14, textAlign: 'center', color: '#9aa0ac', fontSize: 10 }}>
                    {canExpand ? (open ? '▾' : '▸') : ''}
                  </span>
                </div>
                {open && (
                  <div style={{ paddingLeft: 22 }}>
                    <SubRow
                      label="Liên kết"
                      contribPct={sub.affiliate / total}
                      value={sub.affiliate}
                      delta={deltaPct(sub.affiliate, subPrev.affiliate)}
                      fmt={fmt}
                    />
                    <SubRow
                      label="Người bán"
                      contribPct={sub.seller / total}
                      value={sub.seller}
                      delta={deltaPct(sub.seller, subPrev.seller)}
                      fmt={fmt}
                    />
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 8 }}>
            Đóng góp % tính trên tổng GMV. LIVE/Video tách theo Liên kết (affiliate) · Người bán (seller).
          </div>
        </div>
      </div>
    </div>
  )
}

function SubRow({
  label,
  contribPct,
  value,
  delta,
  fmt,
}: {
  label: string
  contribPct: number
  value: number
  delta: { text: string; color: string; show: boolean }
  fmt: (v: number) => string
}) {
  const [isH, setIsH] = useState(false)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        fontSize: 12,
        padding: '7px 8px',
        margin: '0 -8px',
        borderBottom: '1px solid #f7f8fa',
        color: '#5b616e',
        background: isH ? '#f7f8ff' : 'transparent',
        borderRadius: isH ? 7 : 0,
        transition: 'background 0.12s ease',
        cursor: 'default',
      }}
      onMouseEnter={() => setIsH(true)}
      onMouseLeave={() => setIsH(false)}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: isH ? '#3d47d9' : '#c9cdd8', flexShrink: 0, marginLeft: 3, transition: 'background 0.12s ease' }} />
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 10.5, color: '#9aa0ac' }}>(Đóng góp {fmtPct(contribPct)})</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</span>
      <span style={{ color: delta.color, fontWeight: 700, fontSize: 11, width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {delta.show ? delta.text : '—'}
      </span>
      <span style={{ width: 14 }} />
    </div>
  )
}
