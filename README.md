# Nonelab Dashboard

Production scaffold (Vite + React 18 + TypeScript + Tailwind v4) reproducing the
multi-platform (TikTok Shop + Shopee) operations dashboard prototype. The data layer
is built around swappable **connector slots** so each platform can move from mock data
to a real API independently, with zero UI changes.

## Run

```bash
npm install
npm run build     # tsc typecheck + vite build
npm run dev       # dev server (http://localhost:5173, or next free port)
```

### Run with the real TikTok connector (BFF + frontend together)

The TikTok connector's `getDailySeries` is now live-wired against a backend **BFF**
(`server/`). The browser NEVER holds `app_secret` or calls TikTok directly — the BFF
signs + calls TikTok server-side and returns already-normalized `DailyRow[]` JSON.

```bash
cp .env.example .env          # then fill TIKTOK_* for live mode (optional)

# Terminal 1 — BFF (defaults to sample mode, port 8790)
npm run dev:server            # tsx watch server/index.ts

# Terminal 2 — frontend pointed at the API source + BFF (both platforms)
VITE_TIKTOK_SOURCE=api VITE_SHOPEE_SOURCE=api \
  VITE_TIKTOK_BFF_URL=http://localhost:8790 VITE_SHOPEE_BFF_URL=http://localhost:8790 npm run dev
```

Quick check the BFF directly:

```bash
curl "http://localhost:8790/api/tiktok/daily-series?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/tiktok/campaigns?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/tiktok/creators?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/tiktok/top-products?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/tiktok/recon-orders?brand=group"
curl "http://localhost:8790/api/shopee/daily-series?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/shopee/campaigns?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/shopee/top-products?start=2026-06-19&end=2026-07-02&brand=group"
curl "http://localhost:8790/api/shopee/recon-orders?brand=group"
# Internal cost store (persisted; seeds on first run):
curl "http://localhost:8790/api/costs/cogs"
curl -X PUT "http://localhost:8790/api/costs/cogs" -H 'Content-Type: application/json' -d '{"sku":"NL-SRM-30","unitCost":71000}'
curl "http://localhost:8790/api/costs/bookings"
```

### Internal cost store + P&L fold (COGS + KOC bookings)

COGS-by-SKU and KOC bookings are internal (not from any platform API). They are
persisted in the BFF via **SQLite** (`better-sqlite3`, rollback-journal + FULL sync so
committed writes survive an abrupt restart) at `server/store/data/costs.db`, seeded on
first run from the mock catalog + bookings so the demo stays populated.

- CRUD: `GET/PUT /api/costs/cogs` (PUT upserts one SKU), `GET/POST /api/costs/bookings`,
  `DELETE /api/costs/bookings/:id`.
- Frontend cost-store client: `src/data/costStore.ts` (separate from the platform
  connectors — internal data, not a `PlatformConnector`).
- **P&L fold (single source of truth):** `DataRepository` OVERRIDES the aggregate's
  `cogs` and `kocBooking` from the store — ignoring whatever connectors/mock put there,
  to avoid double-counting — then recomputes `profit`/margin/CIR. So it applies
  uniformly on mock and api paths:
  - `cogs = Σ topProducts(period,platform,brand) of qty × storeUnitCost[sku]` (0 if absent)
  - `kocBooking = Σ bookings in the period window, filtered by platform (+ brand)`
  - `profit = netRevenue − cogs − ads − fees.affiliate_comm − kocBooking`
  The **aggregate** identity then holds with residual 0:
  `gmv = profit + cogs + ads + affiliate_comm + (commission+payment+service) +
  (seller_voucher+shipping_borne) + (cancelled+returned) + kocBooking`.
  (Per-DailyRow rows keep cogs/kocBooking = 0 at the row level.)
- **M5** reads/writes the store via the BFF (persists across page reload); Ops-only
  gating unchanged. **M1** cost bar shows the folded COGS + KOC; **top products** and
  **M6 recon** render from the BFF for both platforms.

With both platforms on `api`, the platform filter `all` merges real(sample) TikTok +
Shopee day-by-day (the sample Shopee GMV is ~42% of the combined total, matching the
prototype's ~58/42 split).

**Sample vs live mode** (env `TIKTOK_MODE` and `SHOPEE_MODE`, both default `sample`,
independent so platforms can differ):

- `sample` — loads official-shaped fixtures from `server/fixtures/` and runs them through
  the SAME normalization used for live. No creds needed. This exercises the real
  normalization code path, not a shortcut.
- `live` — calls the real APIs, then runs the identical normalization. THREE DIFFERENT
  APIs are used, each with its own signing:
  - **TikTok Shop Partner API v2** (`server/tiktok/`) — signs (`sign.ts`, HMAC-SHA256 over
    `path + sorted-params [+ body]`, secret-wrapped) + calls Analytics + Finance. Requires
    `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_SHOP_CIPHER`.
  - **TikTok API for Business / Marketing API** (`server/tiktokbiz/`) — NO signing; header
    `Access-Token` + `advertiser_id` query param. Requires `TIKTOK_BIZ_ACCESS_TOKEN`,
    `TIKTOK_ADVERTISER_ID` (base `TIKTOK_BIZ_BASE_URL`).
  - **Shopee Open API v2** (`server/shopee/`) — signs (`sign.ts`) with
    `sign = HMAC_SHA256(partner_key, partner_id + api_path + timestamp + access_token + shop_id)`
    lowercase hex; common query params `partner_id, timestamp, access_token, shop_id, sign`.
    Requires `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ACCESS_TOKEN`,
    `SHOPEE_SHOP_ID` (base `SHOPEE_BASE_URL`; sandbox `partner.test-stable.shopeemobile.com`).

**Shopee escrow → normalized `Fees`** (`server/shopee/normalize.ts`, per order, summed by
local day in Asia/Ho_Chi_Minh):

- `commission_fee` ← `commission_fee`
- `payment_fee` ← `seller_transaction_fee`
- `service_fee` ← `service_fee`
- `seller_voucher` ← `voucher_from_seller` + `seller_coin_cash_back`
- `shipping_borne` ← max(0, `actual_shipping_fee` − `shopee_shipping_rebate` − `buyer_paid_shipping_fee`)
- `affiliate_comm` ← `order_ams_commission_fee` (else 0)

`netRevenue = gmv − cancelled − returned − commission − payment − service − seller_voucher
− shipping_borne`; `cancelled`/`returned` are summed `total_amount` of CANCELLED/RETURN
orders. `profit` is recomputed so the P&L identity residual = 0. On Shopee, `ads` is now
real (from the Shopee CPC ads module — needs Shopee to grant ads permission on the shop,
same auth/signing as order/escrow); still 0: `cogs`/`kocBooking` (internal),
`impressions`/`clicks`, and `sources` split.

**Migration status:**
- TikTok — live via BFF: `getDailySeries` (Analytics + Finance, per-day `ads`),
  `getCampaigns` (Ads Reporting + Campaign), `getCreators` (Affiliate Seller API),
  `getTopProducts` (shop_products/performance), `getReconOrders` (order search + finance).
- Shopee — live via BFF: `getDailySeries` (Order + Escrow, per-day `ads`), `getCampaigns`
  (CPC ads module), `getTopProducts` (order item_list aggregation), `getReconOrders`
  (order detail + escrow). `getCreators` STAYS on the mock shim — Shopee has NO
  affiliate-seller API (KOC via CSV import, `// TODO`).
- `getProductCatalog`/`getBookings` on the connectors are no longer used by the repository
  (catalog + bookings now come from the persisted cost store); kept as mock shims for
  interface completeness.

**BFF layout:**

```
server/
  index.ts                    Express BFF: /api/tiktok/{daily-series,campaigns,creators,
                              top-products,recon-orders}, /api/shopee/{daily-series,
                              campaigns,top-products,recon-orders}, /api/costs/{cogs,bookings}, /health
  store/                      internal cost persistence (SQLite via better-sqlite3)
    db.ts                     listCogs/upsertCogs/listBookings/addBooking/deleteBooking + seeding
    seed.ts                   first-run seed (mock catalog costs + bookings)
    data/                     costs.db (gitignored; created on first run)
  tiktok/                     TikTok Shop Partner API v2 (Analytics + Finance + Affiliate + products/orders)
    sign.ts                   HMAC-SHA256 request signing
    client.ts                 live: signs + calls Analytics + Finance endpoints
    affiliateClient.ts        live: Affiliate Seller API orders (reuses sign.ts)
    catalogClient.ts          live: shop_products/performance + orders/search (reuses sign.ts)
    normalize.ts              -> DailyRow[] (per-day ads) + Creator[] + ProductPerf[] + ReconOrder[]
    types.ts                  server mirrors + raw envelopes
  tiktokbiz/                  TikTok API for Business (Ads) — no signing, Access-Token header
    client.ts                 live: report/integrated/get + campaign/get, paginated
    normalize.ts              report -> Campaign[] and daily {date,adSpend}[] (shared)
    types.ts                  raw report/campaign envelopes + Campaign mirror
  shopee/                     Shopee Open API v2 (Order + Escrow + CPC ads)
    sign.ts                   HMAC-SHA256(partner_key, partner_id+path+ts+token+shop_id)
    client.ts                 live: get_order_list -> get_order_detail + get_escrow_detail
    adsClient.ts              live: get_all_cpc_ads_daily_performance + campaign daily (reuses sign.ts)
    normalize.ts              -> DailyRow[] (per-day ads) + Campaign[] + ProductPerf[] + ReconOrder[]
    types.ts                  server mirrors + raw envelopes
  fixtures/                   official-shaped sample payloads (TikTok Shop/Business/Affiliate/
                              products/orders + Shopee order/escrow/ads, 14 days)
```

## Connector-slot architecture (the point of this scaffold)

The UI depends **only** on `DataRepository` and the domain types in
`src/data/types.ts` — never on a concrete platform or on the mock. Data flows:

```
UI (screens) ──> useDashboard() ──> DataRepository ──> getConnector(platform) ──> PlatformConnector
                                          │                                            ├── MockConnector   (mock/mockData.ts)
                                          │                                            ├── TikTokConnector (stub, real API TODOs)
                                          │                                            └── ShopeeConnector (stub, real API TODOs)
                                          └── merges per-platform results by the active filter
```

- **`src/data/connectors/PlatformConnector.ts`** — the SLOT. Every platform data source
  implements this interface (`getDailySeries`, `getCampaigns`, `getCreators`,
  `getTopProducts`, `getReconOrders`, `getProductCatalog`, `getBookings`). All async, so
  swapping mock → real API is transparent.
- **`MockConnector`** — implements the slot per platform using the deterministic PRNG
  generators ported from the prototype's `data.js` (`src/data/connectors/mock/mockData.ts`).
- **`TikTokConnector` / `ShopeeConnector`** — stubs that `throw new Error('… not implemented')`.
  Each method carries `// TODO` comments naming the real endpoints to implement against.
- **`registry.ts`** — `getConnector(platform)` reads `import.meta.env` to pick mock vs real
  per platform, defaulting to mock. Connectors are cached per platform.
- **`DataRepository.ts`** — the high-level API the UI calls. When the platform filter is
  `'all'` it fans out to **both** connectors and merges (sums aggregates day-by-day and per
  SKU, concatenates lists); otherwise it queries just the one.
- **`src/domain/metrics.ts`** — P&L / KPI derivation on the merged `Aggregate`. Preserves the
  exact identity from `data.js`:
  `GMV = profit + COGS + ads + KOC(affiliate_comm + booking) + (commission + payment + service) + (voucher + shipping) + (cancelled + returned)`.
  Because every aggregate field is additive and profit is recomputed linearly, summing
  per-platform brand-scaled aggregates is numerically identical to the prototype's combined
  path (verified: identity residual = 0).

## Switching a platform from mock → real API

Copy `.env.example` to `.env` and set the per-platform source:

```env
# "mock" (default) or "api"
VITE_TIKTOK_SOURCE=api
VITE_SHOPEE_SOURCE=mock
```

With `VITE_TIKTOK_SOURCE=api`, the registry instantiates `TikTokConnector` for TikTok while
Shopee keeps using the mock. `TikTokConnector.getDailySeries` is live (via the BFF, see above);
its remaining methods delegate to a mock shim for now. Endpoints still to wire up:

- **TikTok Partner API v2** — Analytics `GET /analytics/202405/shop/performance`,
  `/shop_products/performance`, `/shop_lives/performance`; Finance
  `GET /finance/202309/statements` (fees → net); Affiliate Seller API; Ads via TikTok API for
  Business `GET /open_api/v1.3/report/integrated/get/`.
- **Shopee Open API v2** — `/api/v2/order/get_order_list`, `/api/v2/product/get_item_list`,
  `/api/v2/payment/get_escrow_detail` (fees → net), `/api/v2/ads/get_all_cpc_ads_daily_performance`.

Each real connector must normalize platform payloads into the domain types in
`src/data/types.ts` (notably the 9 normalized fee fields). Nothing above the connector changes.

## Project layout

```
src/
  data/
    types.ts                    domain types (Platform, Aggregate, Fees, Campaign, …)
    DataRepository.ts           high-level API, merges by platform filter
    connectors/
      PlatformConnector.ts      the interface slot
      registry.ts               env-driven mock|api selection
      mock/{mockData.ts, MockConnector.ts}
      tiktok/TikTokConnector.ts  stub + endpoint TODOs
      shopee/ShopeeConnector.ts  stub + endpoint TODOs
  domain/metrics.ts             P&L identity + KPI derivation + cost composition
  state/{useDashboard.ts, roles.ts}   filters + fetched data hook, role gating
  lib/{format.ts, tokens.ts, deltaChip.ts}
  components/{layout, ui, charts}
  screens/{OverviewM1, AdsM3, KocM4, CostsM5, ReconM6}.tsx
  App.tsx  main.tsx  index.css
```

## Screens & roles

- **M1 Tổng quan** — profit alert banner, 7 KPI cards with delta chips, line chart,
  "1 đồng GMV đi đâu?" 100% stacked cost bar (7 segments), GMV donut (by platform when
  `all`, else by source), cancel/return rate cards, top-products table.
- **M3 Quảng cáo** — 5 KPI cards + campaign table (Chi phí, Hiển thị, CTR, CPC, CPM, GMV, ROAS).
- **M4 KOC/KOL** — CSV note banner, 4 KPI cards, per-creator ROI table.
- **M5 Quản lý chi phí** — editable COGS-by-SKU table + booking KOC list/add form (Ops only)
  + CSV import card; read-only banner for non-Ops.
- **M6 Đối soát** — 4 KPI cards, orders table with expandable 9-fee breakdown, all/settled/pending filter.

Role switcher (CEO / Brand Manager / Ops) gates which screens are visible via `ROLE_NAV`.
Global filters (brand, platform toggle all/tiktok/shopee, period, compare-toggle) live in the
header and drive re-fetches through `useDashboard`.

## Notes / gaps

- Config knobs from the prototype's design-canvas props (`defaultRole`, `alertMarginPct`,
  `fullNumbers`) are constants in `src/state/roles.ts` (`CONFIG`) rather than a settings UI.
- M5 COGS edits and added bookings are in-memory (session) state, matching the prototype;
  they are not persisted to any connector.
- Charts are hand-rolled SVG/CSS (no chart library), mirroring the prototype exactly.
