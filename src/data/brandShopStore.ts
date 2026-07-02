// Brand + shop config store client (multi-brand / multi-shop), persisted in the BFF.
// Mirrors userStore.ts / costStore.ts. Shop credentials are NEVER returned in the
// clear: the server sends a `configured` map (which fields are set) only.

const BFF_URL =
  import.meta.env.VITE_TIKTOK_BFF_URL ?? import.meta.env.VITE_SHOPEE_BFF_URL ?? 'http://localhost:8790'

export type ShopPlatform = 'tiktok' | 'shopee'
export type ShopMode = 'sample' | 'live'

export interface BrandConfig {
  id: number
  key: string
  name: string
  active: boolean
}

export interface ShopConfig {
  id: number
  brandKey: string
  platform: ShopPlatform
  name: string
  mode: ShopMode
  active: boolean
  /** Which credential fields have a value set (never the values themselves). */
  configured: Record<string, boolean>
  /** True if a refresh token is stored (auto-refresh enabled). */
  autoRefresh: boolean
  /** Last connection-test outcome (persisted). */
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestMsg?: string
}

/** Credential fields collected per platform (matches server CRED_FIELDS order). */
export const CRED_FIELDS: Record<ShopPlatform, { key: string; label: string; secret: boolean }[]> = {
  tiktok: [
    { key: 'appKey', label: 'App Key', secret: false },
    { key: 'appSecret', label: 'App Secret', secret: true },
    { key: 'accessToken', label: 'Access Token', secret: true },
    { key: 'refreshToken', label: 'Refresh Token (auto-refresh)', secret: true },
    { key: 'shopCipher', label: 'Shop Cipher', secret: false },
    { key: 'bizAccessToken', label: 'Ads Access Token (Business)', secret: true },
    { key: 'advertiserId', label: 'Advertiser ID', secret: false },
    { key: 'baseUrl', label: 'Base URL (tuỳ chọn)', secret: false },
    { key: 'bizBaseUrl', label: 'Ads Base URL (tuỳ chọn)', secret: false },
  ],
  shopee: [
    { key: 'partnerId', label: 'Partner ID', secret: false },
    { key: 'partnerKey', label: 'Partner Key', secret: true },
    { key: 'accessToken', label: 'Access Token', secret: true },
    { key: 'refreshToken', label: 'Refresh Token (auto-refresh)', secret: true },
    { key: 'shopId', label: 'Shop ID', secret: false },
    { key: 'baseUrl', label: 'Base URL (tuỳ chọn)', secret: false },
  ],
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BFF_URL}${path}`)
  if (!res.ok) throw new Error(`brand-store ${path} ${res.status}`)
  return (await res.json()) as T
}

// ---- brands ----
export async function fetchBrands(): Promise<BrandConfig[]> {
  try {
    return await getJson<BrandConfig[]>('/api/brands')
  } catch {
    return []
  }
}

export async function addBrand(input: { name: string; key?: string }): Promise<BrandConfig> {
  const res = await fetch(`${BFF_URL}/api/brands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `brand POST ${res.status}`)
  return (await res.json()) as BrandConfig
}

export async function updateBrand(
  id: number,
  patch: { name?: string; active?: boolean },
): Promise<BrandConfig> {
  const res = await fetch(`${BFF_URL}/api/brands/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`brand PUT ${res.status}`)
  return (await res.json()) as BrandConfig
}

export async function deleteBrand(id: number): Promise<void> {
  const res = await fetch(`${BFF_URL}/api/brands/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `brand DELETE ${res.status}`)
}

// ---- shops ----
export async function fetchShops(filter?: {
  brand?: string
  platform?: ShopPlatform
}): Promise<ShopConfig[]> {
  const qs = new URLSearchParams()
  if (filter?.brand) qs.set('brand', filter.brand)
  if (filter?.platform) qs.set('platform', filter.platform)
  const q = qs.toString()
  try {
    return await getJson<ShopConfig[]>(`/api/shops${q ? `?${q}` : ''}`)
  } catch {
    return []
  }
}

export async function addShop(input: {
  brandKey: string
  platform: ShopPlatform
  name: string
  mode?: ShopMode
  active?: boolean
  credentials?: Record<string, string>
}): Promise<ShopConfig> {
  const res = await fetch(`${BFF_URL}/api/shops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `shop POST ${res.status}`)
  return (await res.json()) as ShopConfig
}

export async function updateShop(
  id: number,
  patch: {
    name?: string
    mode?: ShopMode
    active?: boolean
    credentials?: Record<string, string>
  },
): Promise<ShopConfig> {
  const res = await fetch(`${BFF_URL}/api/shops/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`shop PUT ${res.status}`)
  return (await res.json()) as ShopConfig
}

export async function deleteShop(id: number): Promise<void> {
  await fetch(`${BFF_URL}/api/shops/${id}`, { method: 'DELETE' })
}

/** Probe a shop's live connectivity (one real API call server-side). */
export async function testShop(id: number): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${BFF_URL}/api/shops/${id}/test`, { method: 'POST' })
    return (await res.json()) as { ok: boolean; message: string }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Không gọi được BFF' }
  }
}
