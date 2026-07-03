// Internal cost-store client (COGS by SKU + KOC bookings), persisted in the BFF.
// This is SEPARATE from the platform connectors: it is internal data, not a
// PlatformConnector. The DataRepository uses it to fold cogs + kocBooking into the
// P&L as the single source of truth, and the M5 screen uses it to read/write.

import type { Booking, Platform, Product } from './types'

// Same-origin: dev Vite proxies /api → read-API; prod the API serves the web too.
const BFF_URL = import.meta.env.VITE_API_URL ?? ''

export interface CogsEntry {
  sku: string
  name: string
  brand: string
  price: number
  unitCost: number
  effectiveDate: string
}

/** Persisted booking row (has a numeric id from the store). */
export interface StoredBooking extends Booking {
  id: number
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BFF_URL}${path}`)
  if (!res.ok) throw new Error(`cost-store ${path} ${res.status}`)
  return (await res.json()) as T
}

export async function fetchCogs(): Promise<CogsEntry[]> {
  // Resilient read: if the BFF is unreachable, degrade to empty so the app
  // (esp. mock mode) still renders instead of hanging on load.
  try {
    return await getJson<CogsEntry[]>('/api/costs/cogs')
  } catch {
    return []
  }
}

/** Product catalog derived from the persisted COGS rows (cost = current unitCost). */
export async function fetchCatalog(): Promise<Product[]> {
  const rows = await fetchCogs()
  return rows.map((r) => ({
    sku: r.sku,
    brand: r.brand,
    name: r.name,
    cost: r.unitCost,
    price: r.price,
  }))
}

/** sku -> unit cost, for the P&L fold + product margin. */
export async function fetchCogsMap(): Promise<Map<string, number>> {
  const rows = await fetchCogs()
  return new Map(rows.map((r) => [r.sku, r.unitCost]))
}

export async function upsertCogs(sku: string, unitCost: number): Promise<CogsEntry> {
  const res = await fetch(`${BFF_URL}/api/costs/cogs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, unitCost }),
  })
  if (!res.ok) throw new Error(`cost-store PUT cogs ${res.status}`)
  return (await res.json()) as CogsEntry
}

export async function fetchBookings(
  platform: Platform | 'all' = 'all',
  brand = 'group',
): Promise<StoredBooking[]> {
  const q = `?platform=${encodeURIComponent(platform)}&brand=${encodeURIComponent(brand)}`
  try {
    return await getJson<StoredBooking[]>(`/api/costs/bookings${q}`)
  } catch {
    return []
  }
}

export async function addBooking(input: {
  creator: string
  campaign: string
  platform: Platform
  fee: number
  brand: string
}): Promise<StoredBooking> {
  const res = await fetch(`${BFF_URL}/api/costs/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`cost-store POST booking ${res.status}`)
  return (await res.json()) as StoredBooking
}

export async function deleteBooking(id: number): Promise<void> {
  await fetch(`${BFF_URL}/api/costs/bookings/${id}`, { method: 'DELETE' })
}

/** Concrete date (YYYY-MM-DD) from a day-offset, anchored to the app TODAY. */
const TODAY = new Date(2026, 6, 2)
export function dateFromOffset(offset: number): string {
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
