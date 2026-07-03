// Seed data for first-run population, mirrored from the ported mock (data.js):
// product catalog (sku -> unit cost + name/price/brand) and the demo bookings.
// Kept in sync with src/data/connectors/mock/mockData.ts PRODUCTS / BOOKINGS.

export interface SeedProduct {
  sku: string
  brand: string
  name: string
  cost: number
  price: number
}

export const SEED_PRODUCTS: SeedProduct[] = [
  { sku: 'NL-SRM-30', brand: 'nonelab', name: 'Serum B5 Phục hồi 30ml', cost: 62000, price: 189000 },
  { sku: 'NL-KEM-50', brand: 'nonelab', name: 'Kem dưỡng Ceramide 50g', cost: 78000, price: 249000 },
  { sku: 'NL-SRM-B3', brand: 'nonelab', name: 'Serum Niacinamide 10% 30ml', cost: 55000, price: 169000 },
  { sku: 'NL-TAY-150', brand: 'nonelab', name: 'Tẩy trang Micellar 150ml', cost: 32000, price: 99000 },
  { sku: 'NL-CHO-100', brand: 'nonelab', name: 'Sữa rửa mặt Amino 100g', cost: 38000, price: 129000 },
  { sku: 'NL-MAT-60', brand: 'nonelab', name: 'Mặt nạ ngủ Peptide 60g', cost: 52000, price: 179000 },
  { sku: 'NL-CC-30', brand: 'nonelab', name: 'Kem chống nắng SPF50 30g', cost: 68000, price: 215000 },
  { sku: 'NL-SET-3', brand: 'nonelab', name: 'Set Phục hồi da 3 món', cost: 156000, price: 439000 },
  { sku: 'LM-SON-01', brand: 'lumiere', name: 'Son kem lì Velvet 04', cost: 42000, price: 159000 },
  { sku: 'LM-CUSH-02', brand: 'lumiere', name: 'Cushion Glow SPF35', cost: 88000, price: 265000 },
  { sku: 'LM-MASC-03', brand: 'lumiere', name: 'Mascara Longwear', cost: 46000, price: 155000 },
  { sku: 'LM-PHAN-04', brand: 'lumiere', name: 'Phấn phủ kiềm dầu', cost: 52000, price: 185000 },
  { sku: 'LM-KE-05', brand: 'lumiere', name: 'Kẻ mắt nước 24h', cost: 30000, price: 115000 },
  { sku: 'HB-DAU-01', brand: 'herbario', name: 'Dầu gội thảo mộc 300ml', cost: 48000, price: 165000 },
  { sku: 'HB-XA-02', brand: 'herbario', name: 'Xả bưởi 300ml', cost: 45000, price: 155000 },
  { sku: 'HB-TAM-03', brand: 'herbario', name: 'Sữa tắm gừng 400ml', cost: 42000, price: 145000 },
  { sku: 'HB-TINH-04', brand: 'herbario', name: 'Tinh dầu bưởi 50ml', cost: 35000, price: 135000 },
  { sku: 'HB-KEM-05', brand: 'herbario', name: 'Kem tay cúc La Mã', cost: 26000, price: 95000 },
]

export interface SeedBooking {
  creator: string
  campaign: string
  brand: string
  platform: 'tiktok' | 'shopee'
  fee: number
  date: string
  status: string
}

export const SEED_BOOKINGS: SeedBooking[] = [
  { creator: 'Bác sĩ Da liễu Hà', campaign: 'Mega Live 7.7', brand: 'nonelab', platform: 'tiktok', fee: 45e6, date: '2026-07-01', status: 'Đã ký' },
  { creator: 'Linh Skincare', campaign: 'Mega Live 7.7', brand: 'nonelab', platform: 'tiktok', fee: 30e6, date: '2026-06-28', status: 'Đã ký' },
  { creator: 'Ăn gì mua gì', campaign: 'Shopee 7.7 Sale', brand: 'herbario', platform: 'shopee', fee: 22e6, date: '2026-06-27', status: 'Đã ký' },
  { creator: 'Mai Review', campaign: 'Lumière Beauty Day', brand: 'lumiere', platform: 'tiktok', fee: 8e6, date: '2026-06-25', status: 'Đang đàm phán' },
  { creator: 'Hana Đánh giá', campaign: 'Shopee Video T7', brand: 'herbario', platform: 'shopee', fee: 6.5e6, date: '2026-06-24', status: 'Đã ký' },
  { creator: 'Skincare cùng Tú', campaign: 'Video seeding T7', brand: 'nonelab', platform: 'tiktok', fee: 5e6, date: '2026-06-22', status: 'Hoàn thành' },
]

// ---- Users (platform + channel view permissions) ----
export type UserRole = 'ceo' | 'bm' | 'ops'
export type UserPlatform = 'tiktok' | 'shopee'
export type UserChannel = 'live' | 'video' | 'card' | 'search'

export interface SeedUser {
  name: string
  email: string
  role: UserRole
  platforms: UserPlatform[]
  channels: UserChannel[]
  active: boolean
}

export const SEED_USERS: SeedUser[] = [
  {
    name: 'Nguyễn Điều Hành',
    email: 'ceo@nonelab.vn',
    role: 'ceo',
    platforms: ['tiktok', 'shopee'],
    channels: ['live', 'video', 'card', 'search'],
    active: true,
  },
  {
    name: 'Trần Brand TikTok',
    email: 'bm.tiktok@nonelab.vn',
    role: 'bm',
    platforms: ['tiktok'],
    channels: ['live', 'video', 'card'],
    active: true,
  },
  {
    name: 'Lê Brand Shopee',
    email: 'bm.shopee@nonelab.vn',
    role: 'bm',
    platforms: ['shopee'],
    channels: ['card', 'search'],
    active: true,
  },
  {
    name: 'Phạm Vận Hành',
    email: 'ops@nonelab.vn',
    role: 'ops',
    platforms: ['tiktok', 'shopee'],
    channels: ['live', 'video', 'card', 'search'],
    active: true,
  },
  {
    name: 'Đỗ Cộng Tác',
    email: 'ctv@nonelab.vn',
    role: 'ops',
    platforms: ['shopee'],
    channels: ['search'],
    active: false,
  },
]

// ---- Revenue KPI targets: 12 monthly targets per year, PER BRAND (set by BM) — VND ----
// The BM only sets monthly targets per brand; day/week/quarter/year are DERIVED (see
// src/lib/kpiProgress.ts). 'group' KPI = element-wise SUM across brands (not stored).
// Seeded for 2026 at 3 tỷ / month / brand (so group = 9 tỷ / month).
export const SEED_KPI_YEAR = 2026
export const SEED_KPI_MONTHS: number[] = Array.from({ length: 12 }, () => 3_000_000_000)
/** Brands that get their own per-month KPI targets. */
export const SEED_KPI_BRANDS: string[] = ['nonelab', 'lumiere', 'herbario']

// ---- Brands + Shops (multi-brand / multi-shop; credentials stored per shop) ----
export type ShopPlatform = 'tiktok' | 'shopee'
export type ShopMode = 'sample' | 'live'

export interface SeedBrand {
  key: string
  name: string
}

// Seed brands mirror the KPI/mock brands so the header dropdown is unchanged on
// first run. Users add their own brands via the admin screen afterwards.
export const SEED_BRANDS: SeedBrand[] = [
  { key: 'nonelab', name: 'Nonelab' },
  { key: 'lumiere', name: 'Lumière' },
  { key: 'herbario', name: 'Herbario' },
]

export interface SeedShop {
  brandKey: string
  platform: ShopPlatform
  name: string
  mode: ShopMode
}

// No demo shops seeded — users add their real shops via the admin screen.
export const SEED_SHOPS: SeedShop[] = []
