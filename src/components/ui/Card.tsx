import type { CSSProperties, ReactNode } from 'react'

export function Card({
  children,
  style,
  className,
}: {
  children: ReactNode
  style?: CSSProperties
  className?: string
}) {
  return (
    <div
      className={className}
      style={{
        background: '#fff',
        border: '1px solid #e6e8ee',
        borderRadius: 13,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
