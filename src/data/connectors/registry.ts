// Connector registry — chooses mock vs real per platform from env at build/runtime.
// VITE_TIKTOK_SOURCE / VITE_SHOPEE_SOURCE = 'mock' (default) | 'api'.

import type { Platform } from '../types'
import type { PlatformConnector } from './PlatformConnector'
import { MockConnector } from './mock/MockConnector'
import { TikTokConnector } from './tiktok/TikTokConnector'
import { ShopeeConnector } from './shopee/ShopeeConnector'

type Source = 'mock' | 'api'

function sourceFor(platform: Platform): Source {
  const raw =
    platform === 'tiktok'
      ? import.meta.env.VITE_TIKTOK_SOURCE
      : import.meta.env.VITE_SHOPEE_SOURCE
  return raw === 'api' ? 'api' : 'mock'
}

const cache = new Map<Platform, PlatformConnector>()

export function getConnector(platform: Platform): PlatformConnector {
  const cached = cache.get(platform)
  if (cached) return cached

  const source = sourceFor(platform)
  let connector: PlatformConnector
  if (source === 'api') {
    connector = platform === 'tiktok' ? new TikTokConnector() : new ShopeeConnector()
  } else {
    connector = new MockConnector(platform)
  }
  cache.set(platform, connector)
  return connector
}
