import { platformBadge } from '../../lib/tokens'

export function PlatformBadge({ platform, small }: { platform: 'tiktok' | 'shopee'; small?: boolean }) {
  const b = platformBadge(platform)
  return (
    <span
      style={{
        fontSize: small ? 10 : 10.5,
        fontWeight: 700,
        color: '#fff',
        background: b.bg,
        borderRadius: 6,
        padding: small ? '3px 7px' : '3px 8px',
      }}
    >
      {b.label}
    </span>
  )
}
