export type Role = 'ceo' | 'bm' | 'ops'
export type ScreenId = 'm1' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7' | 'm8' | 'm9' | 'm10'

// Screen gating per role (ROLE_NAV in the prototype). M8 (user management) and
// M10 (brands & shops config) are CEO-only; M9 (KPI targets) is BM + CEO (not Ops).
export const ROLE_NAV: Record<Role, ScreenId[]> = {
  ceo: ['m1', 'm3', 'm4', 'm7', 'm8', 'm9', 'm10'],
  bm: ['m1', 'm3', 'm4', 'm5', 'm7', 'm9'],
  ops: ['m1', 'm5', 'm6', 'm7'],
}

export const SCREENS: Record<ScreenId, { label: string; title: string; sub: string }> = {
  m1: {
    label: 'Tổng quan',
    title: 'Tổng quan điều hành',
    sub: 'Doanh thu, lợi nhuận, cơ cấu chi phí, nguồn GMV và top sản phẩm — TikTok Shop + Shopee',
  },
  m3: {
    label: 'Quảng cáo',
    title: 'Hiệu suất quảng cáo',
    sub: 'Chi phí, CTR, CPC, ROAS theo campaign',
  },
  m4: {
    label: 'KOC / KOL',
    title: 'Hiệu suất KOC / KOL',
    sub: 'GMV, hoa hồng, booking và ROI từng creator',
  },
  m5: {
    label: 'Quản lý chi phí',
    title: 'Quản lý chi phí',
    sub: 'Nhập COGS theo SKU, booking KOC và import CSV',
  },
  m6: {
    label: 'Đối soát',
    title: 'Đối soát đơn & phí',
    sub: 'Phí breakdown từng đơn — tạm tính vs đã đối soát',
  },
  m7: {
    label: 'Đơn hàng',
    title: 'Tất cả đơn hàng',
    sub: 'Toàn bộ đơn từ TikTok Shop + Shopee — bấm vào đơn để xem cấu trúc phí',
  },
  m8: {
    label: 'Quản lý user',
    title: 'Quản lý người dùng & phân quyền',
    sub: 'Cấp quyền xem theo sàn và theo kênh cho từng user — chỉ CEO',
  },
  m9: {
    label: 'Mục tiêu KPI',
    title: 'Mục tiêu & so sánh KPI doanh thu',
    sub: 'BM đặt mục tiêu ngày/tháng/quý/năm — cộng dồn & chia đều nếu chưa đạt',
  },
  m10: {
    label: 'Thương hiệu & Shop',
    title: 'Quản lý thương hiệu & shop',
    sub: 'Thêm thương hiệu, gắn shop TikTok/Shopee và cấu hình credential để lấy dữ liệu — chỉ CEO',
  },
}

export const SCREEN_ICONS: Record<ScreenId, string> = {
  m1: '◧',
  m3: '◎',
  m4: '☺',
  m5: '▤',
  m6: '☑',
  m7: '▦',
  m8: '⚙',
  m9: '⊛',
  m10: '⬡',
}

export const ROLE_META: { id: Role; label: string; desc: string; initial: string }[] = [
  { id: 'ceo', label: 'CEO', desc: 'Toàn sàn · chỉ xem', initial: 'CE' },
  { id: 'bm', label: 'Brand Manager', desc: 'Theo sàn · chỉ xem', initial: 'BM' },
  { id: 'ops', label: 'Ops', desc: 'Nhập liệu · đối soát', initial: 'OP' },
]

// Prototype config props (data-props defaults).
export const CONFIG = {
  defaultRole: 'ceo' as Role,
  alertMarginPct: 5, // %
  fullNumbers: false,
}
