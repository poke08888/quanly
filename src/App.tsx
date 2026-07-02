import { useDashboard } from './state/useDashboard'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { OverviewM1 } from './screens/OverviewM1'
import { AdsM3 } from './screens/AdsM3'
import { KocM4 } from './screens/KocM4'
import { CostsM5 } from './screens/CostsM5'
import { ReconM6 } from './screens/ReconM6'
import { OrdersM7 } from './screens/OrdersM7'
import { UsersM8 } from './screens/UsersM8'
import { KpiM9 } from './screens/KpiM9'

export function App() {
  const s = useDashboard()

  return (
    <div className="nl-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar s={s} />
      <main className="nl-main" style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        <Header s={s} />
        <div
          className="nl-content"
          style={{ padding: '22px 28px 40px', maxWidth: 1760, margin: '0 auto' }}
        >
          {!s.data ? (
            s.error ? (
              <div style={{ padding: 40, color: '#b3261e', fontSize: 13 }}>
                Không tải được dữ liệu: {s.error}. Kiểm tra server dữ liệu (BFF :8790) rồi tải lại trang.
              </div>
            ) : (
              <div style={{ padding: 40, color: '#9aa0ac', fontSize: 13 }}>Đang tải dữ liệu…</div>
            )
          ) : (
            <>
              {s.screen === 'm1' && <OverviewM1 s={s} />}
              {s.screen === 'm3' && <AdsM3 s={s} />}
              {s.screen === 'm4' && <KocM4 s={s} />}
              {s.screen === 'm5' && <CostsM5 s={s} />}
              {s.screen === 'm6' && <ReconM6 s={s} />}
              {s.screen === 'm7' && <OrdersM7 s={s} />}
              {s.screen === 'm8' && <UsersM8 s={s} />}
              {s.screen === 'm9' && <KpiM9 s={s} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
