// M9 "Mục tiêu KPI" — SETTING-only. BM/CEO set the 12 monthly revenue targets for a
// year; day/week/quarter/year are DERIVED (shown read-only). The actual-vs-target
// PROGRESS lives on M1 (Overview), not here. Persisted via the BFF.
import { useEffect, useState } from 'react'
import type { DashboardState } from '../state/useDashboard'
import { TODAY } from '../lib/period'
import { deriveTargets } from '../lib/kpiProgress'

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `Tháng ${i + 1}`)

export function KpiM9({ s }: { s: DashboardState }) {
  const d = s.data
  if (!d) return null
  const fmt = s.fmt
  const year = s.kpiYear
  const months = d.kpiMonthly.months
  const derived = deriveTargets(months, TODAY)
  const curMonth = TODAY.getMonth() + 1 // 1-based, for highlighting
  // Only highlight/anchor the "current" month when viewing TODAY's year.
  const showCurrent = year === TODAY.getFullYear()
  // 'group' KPI = sum across brands -> read-only. A specific brand is editable by BM/CEO.
  const isGroup = s.brand === 'group'
  const brandName = s.brandOptions.find((b) => b.id === s.brand)?.name ?? s.brand
  const canEdit = s.canEditKpi && !isGroup

  return (
    <div className="nl-fade">
      {isGroup ? (
        <div style={noteBox}>
          KPI toàn group = tổng các brand — chọn 1 brand ở bộ lọc trên đầu để đặt mục tiêu.
        </div>
      ) : (
        !s.canEditKpi && (
          <div style={noteBox}>
            Bạn đang xem ở chế độ chỉ đọc. Chỉ Brand Manager (hoặc CEO) được đặt mục tiêu KPI.
          </div>
        )
      )}

      {/* year selector + monthly grid */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Mục tiêu doanh thu theo tháng — {brandName}</div>
            <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>
              {isGroup
                ? 'Toàn group là tổng mục tiêu các brand (chỉ xem).'
                : 'Chỉ nhập mục tiêu tháng — hệ thống tự suy ra ngày / tuần / quý / năm. Lưu khi rời ô / nhấn Enter.'}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: '#7c828f', fontWeight: 600 }}>Năm</span>
            <select
              value={year}
              onChange={(e) => s.setKpiYear(Number(e.target.value))}
              style={{ ...inp, padding: '6px 10px', background: '#fff' }}
            >
              {[TODAY.getFullYear() - 1, TODAY.getFullYear(), TODAY.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 10,
            marginTop: 14,
          }}
        >
          {MONTH_LABELS.map((label, i) => (
            <MonthInput
              key={i}
              label={label}
              value={months[i]}
              highlight={showCurrent && i + 1 === curMonth}
              canEdit={canEdit}
              onSave={(v) => s.saveKpiMonth(year, i + 1, v)}
              fmt={fmt}
            />
          ))}
        </div>
      </div>

      {/* derived read-only summary */}
      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>Mục tiêu suy ra (tự động)</div>
        <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 2 }}>
          Từ mục tiêu tháng {curMonth} / quý hiện tại / năm {year} — không chỉnh trực tiếp.
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginTop: 14,
          }}
        >
          <DerivedStat label={`Ngày (tháng ${curMonth})`} value={fmt(derived.daily)} />
          <DerivedStat label="Tuần" value={fmt(derived.weekly)} />
          <DerivedStat label={`Tháng ${curMonth}`} value={fmt(derived.monthly)} />
          <DerivedStat label="Quý hiện tại" value={fmt(derived.quarterly)} />
          <DerivedStat label={`Năm ${year}`} value={fmt(derived.yearly)} />
        </div>
      </div>
    </div>
  )
}

function MonthInput({
  label,
  value,
  highlight,
  canEdit,
  onSave,
  fmt,
}: {
  label: string
  value: number
  highlight: boolean
  canEdit: boolean
  onSave: (v: number) => void
  fmt: (v: number) => string
}) {
  const [val, setVal] = useState(String(value))
  useEffect(() => setVal(String(value)), [value])
  const num = Number(val) || 0
  const commit = () => {
    if (canEdit && num !== value) onSave(num)
  }
  return (
    <div>
      <div style={{ ...labelCap, color: highlight ? '#3d47d9' : '#9aa0ac' }}>
        {label}
        {highlight ? ' • hiện tại' : ''}
      </div>
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
          border: `1px solid ${highlight ? '#c3c8f5' : '#d9dce4'}`,
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 12.5,
          fontVariantNumeric: 'tabular-nums',
          background: canEdit ? '#fff' : '#f4f5f8',
          outlineColor: '#3d47d9',
        }}
      />
      <div style={{ fontSize: 10.5, color: '#9aa0ac', marginTop: 3 }}>{fmt(num)}</div>
    </div>
  )
}

function DerivedStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 10, padding: '12px 14px' }}>
      <div style={labelCap}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#191c22', marginTop: 3 }}>
        {value}
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
const noteBox = {
  background: '#eef1fb',
  border: '1px solid #ccd4f0',
  borderRadius: 12,
  padding: '10px 16px',
  marginBottom: 14,
  fontSize: 12.5,
  color: '#33418f',
} as const
const labelCap = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#9aa0ac',
  marginBottom: 4,
} as const
const inp = {
  border: '1px solid #d9dce4',
  borderRadius: 8,
  fontSize: 12.5,
  outlineColor: '#3d47d9',
} as const
