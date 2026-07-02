// Shopee real-API connector.
// The browser must NEVER hold partner_key or call Shopee directly (CORS + secret
// leakage). So this connector only fetches ALREADY-NORMALIZED DailyRow[] from the
// backend BFF (see server/shopee/), which signs + calls Shopee server-side.
//
// getDailySeries (Order + Escrow -> DailyRow[]) is live-wired via the BFF. The
// remaining methods delegate to an internal MockConnector('shopee') as a TEMPORARY
// migration shim so the app stays fully functional when VITE_SHOPEE_SOURCE=api.
// Each is marked // TODO replace with BFF call. Switch on via VITE_SHOPEE_SOURCE=api.

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

const BFF_URL = import.meta.env.VITE_SHOPEE_BFF_URL ?? 'http://localhost:8790'

/** Must match mockData's TODAY (2 Jul 2026) so day-offsets map to the same dates. */
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

export class ShopeeConnector implements PlatformConnector {
  readonly platform = 'shopee' as const
  readonly isMock = false

  /** Temporary shim for not-yet-implemented methods. */
  private readonly mock = new MockConnector('shopee')

  async getDailySeries(startOffset: number, endOffset: number, brand: string): Promise<DailyRow[]> {
    // App args are day-offsets (start >= end, days-ago). Convert to concrete dates.
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    const url =
      `${BFF_URL}/api/shopee/daily-series` +
      `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&brand=${encodeURIComponent(brand)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Shopee BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as DailyRow[]
  }

  async getCampaigns(startOffset: number, endOffset: number, brand: string): Promise<Campaign[]> {
    // Live via BFF: Shopee CPC ads module -> Campaign[]. (Requires Shopee to grant
    // ads permission on the shop; auth/signing is the same as order/escrow.)
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    const url =
      `${BFF_URL}/api/shopee/campaigns` +
      `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&brand=${encodeURIComponent(brand)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Shopee BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as Campaign[]
  }
  async getCreators(startOffset: number, endOffset: number, brand: string): Promise<Creator[]> {
    // STAYS mock: Shopee has NO affiliate-seller API — Shopee KOC data comes via
    // CSV import (Affiliate/AMS), not an API. // TODO wire CSV import path, not BFF.
    return this.mock.getCreators(startOffset, endOffset, brand)
  }
  async getTopProducts(
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<ProductPerf[]> {
    // Live via BFF: order item_list aggregation -> ProductPerf[] (margin via store cogs).
    const start = dateFromOffset(startOffset)
    const end = dateFromOffset(endOffset)
    return this.fetchJson<ProductPerf[]>(
      `/api/shopee/top-products?start=${start}&end=${end}&brand=${encodeURIComponent(brand)}`,
    )
  }
  async getReconOrders(brand: string): Promise<ReconOrder[]> {
    // Live via BFF: order detail + escrow -> ReconOrder[] (9 normalized fees, net=escrow).
    return this.fetchJson<ReconOrder[]>(`/api/shopee/recon-orders?brand=${encodeURIComponent(brand)}`)
  }
  async getProductCatalog(): Promise<Product[]> {
    // Not used by the repository (catalog now from the persisted cost store).
    return this.mock.getProductCatalog()
  }
  async getBookings(brand: string): Promise<Booking[]> {
    // Not used by the repository (bookings now from the persisted cost store).
    return this.mock.getBookings(brand)
  }

  private async fetchJson<T>(pathAndQuery: string): Promise<T> {
    const res = await fetch(`${BFF_URL}${pathAndQuery}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Shopee BFF ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  }
}
