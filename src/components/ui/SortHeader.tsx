// Clickable table-header cell with a sort-direction indicator.
// `↕` when inactive, `▲`/`▼` when this column is the active sort.
import type { SortDir } from '../../lib/useSort'

export function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 9, lineHeight: 1, color: active ? '#3d47d9' : '#c9cdd8' }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </div>
  )
}
