// TikTok Shop real-API connector.
// The browser must NEVER hold app_secret or call TikTok directly (CORS + secret
// leakage). So this connector only fetches ALREADY-NORMALIZED DailyRow[] from the
// backend BFF (see server/), which signs + calls TikTok server-side.
//
// getDailySeries (Analytics+Finance), getCampaigns (API for Business Ads) and
// getCreators (Affiliate Seller API) are live-wired via the BFF. The remaining
// methods still delegate to an internal MockConnector as a TEMPORARY migration shim
// so the app stays fully functional when VITE_TIKTOK_SOURCE=api. Each is marked
// // TODO replace with BFF call. Switch on via VITE_TIKTOK_SOURCE=api (see registry.ts).

import type { PlatformConnector } from '../PlatformConnector'
import type {
  Booking,
  Campaign,
  Creator,
  DailyRow,
  Product,
  ProductPerf,
  ReconOrder,
} from '../../types'
import { MockConnector } from '../mock/MockConnector'

const BFF_URL = import.meta.env.VITE_TIKTOK_BFF_URL ?? 'http://localhost:8790'

/** The mock's reference "today" (2 Jul 2026) — must match mockData's TODAY so
 *  day-offsets convert to the same calendar dates the fixtures/API cover. */
const TODAY = new Date(2026, 6, 2)

function dateFromOffset(offset: number): string {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - offset)
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

export class TikTokConnector implements PlatformConnector {
  readonly platform = 'tiktok' as const
  readonly isMock = false

  /** Temporary shim for not-yet-implemented methods. */
  private readonly mock = new MockConnector('tiktok')

  async getDailySeries(startOffset: number, endOffset: number, brand: string): Promise<DailyRow[]> {
    // App args are day-offsets (start >= end, days-ago). Convert to concrete dates.
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    const url =
      `${BFF_URL}/api/tiktok/daily-series` +
      `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&brand=${encodeURIComponent(brand)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`TikTok BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as DailyRow[]
  }

  async getCampaigns(startOffset: number, endOffset: number, brand: string): Promise<Campaign[]> {
    // Live via BFF: TikTok API for Business (Reporting + Campaign) -> Campaign[].
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    const url =
      `${BFF_URL}/api/tiktok/campaigns` +
      `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&brand=${encodeURIComponent(brand)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`TikTok BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as Campaign[]
  }
  async getCreators(startOffset: number, endOffset: number, brand: string): Promise<Creator[]> {
    // Live via BFF: TikTok Shop Affiliate Seller API -> Creator[].
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    const url =
      `${BFF_URL}/api/tiktok/creators` +
      `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&brand=${encodeURIComponent(brand)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`TikTok BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as Creator[]
  }
  async getTopProducts(
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<ProductPerf[]> {
    // Live via BFF: shop_products/performance -> ProductPerf[] (margin via store cogs).
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    return this.fetchJson<ProductPerf[]>(
      `/api/tiktok/top-products?start=${start}&end=${end}&brand=${encodeURIComponent(brand)}`,
    )
  }
  async getReconOrders(brand: string): Promise<ReconOrder[]> {
    // Live via BFF: order search + finance statements -> ReconOrder[] (9 normalized fees).
    return this.fetchJson<ReconOrder[]>(`/api/tiktok/recon-orders?brand=${encodeURIComponent(brand)}`)
  }
  async getProductCatalog(): Promise<Product[]> {
    // Not used by the repository (catalog now comes from the persisted cost store);
    // kept for interface completeness. // TODO product/202309/products/search if needed.
    return this.mock.getProductCatalog()
  }
  async getBookings(brand: string): Promise<Booking[]> {
    // Not used by the repository (bookings now come from the persisted cost store);
    // kept for interface completeness. // TODO internal booking store via BFF.
    return this.mock.getBookings(brand)
  }

  private async fetchJson<T>(pathAndQuery: string): Promise<T> {
    const res = await fetch(`${BFF_URL}${pathAndQuery}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`TikTok BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  }
}
