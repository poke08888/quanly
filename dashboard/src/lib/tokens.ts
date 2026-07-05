// Exact design tokens from the prototype.
export const C = {
  bg: '#f2f3f6',
  card: '#fff',
  border: '#e6e8ee',
  ink: '#191c22',
  muted: '#7c828f',
  muted2: '#9aa0ac',
  indigo: '#3d47d9',
  green: '#0f9d6b',
  orange: '#e8890c',
  red: '#e5484d',
  tiktok: '#191c22',
  shopee: '#ee4d2d',
} as const

export function platformBadge(pf: 'tiktok' | 'shopee'): { label: string; bg: string } {
  return pf === 'tiktok'
    ? { label: 'TikTok', bg: '#191c22' }
    : { label: 'Shopee', bg: '#ee4d2d' }
}

// GMV-source palette (M1 pie when a single platform is selected).
export const SOURCE_COLORS: Record<string, string> = {
  live: '#3d47d9',
  video: '#8f5be8',
  card: '#e8890c',
  search: '#0f9d6b',
  affiliate: '#0e7490',
}
export const SOURCE_LABELS: Record<string, string> = {
  live: 'LIVE',
  video: 'Video',
  card: 'Thẻ sản phẩm',
  search: 'Tìm kiếm',
  affiliate: 'Tiếp thị liên kết',
}

export const FEE_LABELS: Record<string, string> = {
  commission_fee: 'Hoa hồng sàn',
  payment_fee: 'Phí thanh toán',
  service_fee: 'Phí dịch vụ',
  seller_voucher: 'Voucher seller',
  shipping_borne: 'Ship seller chịu',
  affiliate_comm: 'Hoa hồng KOC',
}
