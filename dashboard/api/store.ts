// Re-export hub for the shared SQLite store. The read-API reuses the SAME store module
// as the old server (single source of truth for schema, auth hashing, credential
// encryption, multi-shop resolve). No external API calls live here — reads + config only.
export {
  listCogs,
  cogsMap,
  upsertCogs,
  listBookings,
  addBooking,
  deleteBooking,
  listUsers,
  getUser,
  addUser,
  upsertUser,
  deleteUser,
  setUserPassword,
  checkLogin,
  getKpiMonthly,
  setKpiMonth,
  listBrands,
  addBrand,
  updateBrand,
  deleteBrand,
  listShopsMasked,
  addShop,
  updateShop,
  deleteShop,
  loadDailyRows,
  loadSnapshot,
  loadRawOrders,
  loadReconCache,
  type ShopRow,
} from '../../server/store/db'

export {
  mergeDailyRows,
  mergeCampaigns,
  mergeCreators,
  mergeTopProducts,
  mergeRecon,
} from '../../server/shops'
