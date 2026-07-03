import { lazy, Suspense } from 'react'
import { useDashboard, type DashboardState } from './state/useDashboard'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { Login } from './components/Login'

// Code-split each screen so only the active screen's JS is fetched.
const OverviewM1 = lazy(() => import('./screens/OverviewM1').then((m) => ({ default: m.OverviewM1 })))
const AdsM3 = lazy(() => import('./screens/AdsM3').then((m) => ({ default: m.AdsM3 })))
const KocM4 = lazy(() => import('./screens/KocM4').then((m) => ({ default: m.KocM4 })))
const CostsM5 = lazy(() => import('./screens/CostsM5').then((m) => ({ default: m.CostsM5 })))
const ReconM6 = lazy(() => import('./screens/ReconM6').then((m) => ({ default: m.ReconM6 })))
const OrdersM7 = lazy(() => import('./screens/OrdersM7').then((m) => ({ default: m.OrdersM7 })))
const UsersM8 = lazy(() => import('./screens/UsersM8').then((m) => ({ default: m.UsersM8 })))
const KpiM9 = lazy(() => import('./screens/KpiM9').then((m) => ({ default: m.KpiM9 })))
const BrandsM10 = lazy(() => import('./screens/BrandsM10').then((m) => ({ default: m.BrandsM10 })))

const muted = (msg: string) => <div style={{ padding: 40, color: '#9aa0ac', fontSize: 13 }}>{msg}</div>

// m7 (Đơn hàng) and m10 (Brands) manage their own data — they don't need s.data.
const SELF_DATA = new Set(['m7', 'm10'])

function Screen({ s }: { s: DashboardState }) {
  if (!SELF_DATA.has(s.screen) && !s.data) {
    return s.error ? (
      <div style={{ padding: 40, color: '#b3261e', fontSize: 13 }}>
        Không tải được dữ liệu: {s.error}. Kiểm tra API dữ liệu rồi tải lại trang.
      </div>
    ) : (
      muted('Đang tải dữ liệu…')
    )
  }
  return (
    <Suspense fallback={muted('Đang tải…')}>
      {s.screen === 'm1' && <OverviewM1 s={s} />}
      {s.screen === 'm3' && <AdsM3 s={s} />}
      {s.screen === 'm4' && <KocM4 s={s} />}
      {s.screen === 'm5' && <CostsM5 s={s} />}
      {s.screen === 'm6' && <ReconM6 s={s} />}
      {s.screen === 'm7' && <OrdersM7 s={s} />}
      {s.screen === 'm8' && <UsersM8 s={s} />}
      {s.screen === 'm9' && <KpiM9 s={s} />}
      {s.screen === 'm10' && <BrandsM10 s={s} />}
    </Suspense>
  )
}

export function App() {
  const s = useDashboard()

  if (!s.authReady) return muted('Đang kiểm tra phiên đăng nhập…')
  if (!s.authUser) return <Login onLogin={s.login} />

  return (
    <div className="nl-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar s={s} />
      <main className="nl-main" style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        <Header s={s} />
        <div className="nl-content" style={{ padding: '22px 28px 40px', maxWidth: 1760, margin: '0 auto' }}>
          <Screen s={s} />
        </div>
      </main>
    </div>
  )
}
