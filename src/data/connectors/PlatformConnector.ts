// The SLOT. Every platform data source (mock now, real API later) implements
// this interface. The DataRepository is the only caller; the UI never touches
// a connector directly. Swap mock->real per platform via the registry + env.

import type {
  Booking,
  Campaign,
  Creator,
  DailyRow,
  Platform,
  Product,
  ProductPerf,
  ReconOrder,
} from '../types'

export interface PlatformConnector {
  /** Which platform this connector serves. */
  readonly platform: Platform
  /** True for the deterministic mock source; false for a real API source. */
  readonly isMock: boolean

  getDailySeries(startOffset: number, endOffset: number, brand: string): Promise<DailyRow[]>
  getCampaigns(startOffset: number, endOffset: number, brand: string): Promise<Campaign[]>
  getCreators(startOffset: number, endOffset: number, brand: string): Promise<Creator[]>
  getTopProducts(startOffset: number, endOffset: number, brand: string): Promise<ProductPerf[]>
  getReconOrders(brand: string): Promise<ReconOrder[]>
  getProductCatalog(): Promise<Product[]>
  getBookings(brand: string): Promise<Booking[]>
}
