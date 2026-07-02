// Shared hover-tooltip pattern for charts: a small absolutely-positioned box over
// a position:relative chart container, driven by React state. Dependency-free.
import { useState, type ReactNode } from 'react'

export interface TooltipState {
  x: number
  y: number
  content: ReactNode
  visible: boolean
}

const HIDDEN: TooltipState = { x: 0, y: 0, content: null, visible: false }

export function useTooltip() {
  const [tip, setTip] = useState<TooltipState>(HIDDEN)
  const show = (x: number, y: number, content: ReactNode) => setTip({ x, y, content, visible: true })
  const hide = () => setTip((t) => (t.visible ? HIDDEN : t))
  return { tip, show, hide }
}

/**
 * Renders the tooltip inside a position:relative parent. `containerW` clamps the
 * box so it never overflows the card's right edge.
 */
export function ChartTooltip({ tip, containerW }: { tip: TooltipState; containerW?: number }) {
  if (!tip.visible) return null
  const W = 170
  // Prefer placing to the right of the cursor; flip left near the edge.
  let left = tip.x + 12
  if (containerW && left + W > containerW) left = Math.max(4, tip.x - W - 12)
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: Math.max(4, tip.y - 8),
        maxWidth: W,
        pointerEvents: 'none',
        background: '#191c22',
        color: '#fff',
        borderRadius: 8,
        padding: '7px 10px',
        fontSize: 11.5,
        lineHeight: 1.5,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        zIndex: 20,
        whiteSpace: 'nowrap',
      }}
    >
      {tip.content}
    </div>
  )
}

/** A colored dot + label + value row for use inside tooltip content. */
export function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      {color && <span style={{ width: 8, height: 8, borderRadius: 3, background: color, flexShrink: 0 }} />}
      <span style={{ color: '#c9cdd8', flex: 1 }}>{label}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginLeft: 10 }}>{value}</span>
    </div>
  )
}
