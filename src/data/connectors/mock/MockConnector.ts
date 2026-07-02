// Mock connector — implements PlatformConnector for a single platform using the
// deterministic generators ported from data.js. Fully async so the swap to a real
// API connector is transparent to the DataRepository and UI.

import type { PlatformConnector } from '../PlatformConnector'
import type {
  Booking,
  Campaign,
  Creator,
  DailyRow,
  Platform,
  Product,
  ProductPerf,
  ReconOrder,
} from '../../types'
import {
  bookingsOne,
  campaignsOne,
  creatorsOne,
  dailyRowsOne,
  productCatalog,
  reconOrdersOne,
  topProductsOne,
} from './mockData'

export class MockConnector implements PlatformConnector {
  readonly isMock = true
  constructor(readonly platform: Platform) {}

  async getDailySeries(startOffset: number, endOffset: number, brand: string): Promise<DailyRow[]> {
    return dailyRowsOne(this.platform, startOffset, endOffset, brand)
  }
  async getCampaigns(startOffset: number, endOffset: number, brand: string): Promise<Campaign[]> {
    return campaignsOne(this.platform, startOffset, endOffset, brand)
  }
  async getCreators(startOffset: number, endOffset: number, brand: string): Promise<Creator[]> {
    return creatorsOne(this.platform, startOffset, endOffset, brand)
  }
  async getTopProducts(
    startOffset: number,
    endOffset: number,
    brand: string,
  ): Promise<ProductPerf[]> {
    return topProductsOne(this.platform, startOffset, endOffset, brand)
  }
  async getReconOrders(brand: string): Promise<ReconOrder[]> {
    return reconOrdersOne(this.platform, brand)
  }
  async getProductCatalog(): Promise<Product[]> {
    return productCatalog()
  }
  async getBookings(brand: string): Promise<Booking[]> {
    return bookingsOne(this.platform, brand)
  }
}
