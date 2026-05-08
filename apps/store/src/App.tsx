import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage.js'
import { DashboardPage } from './pages/DashboardPage.js'
import { ProductsPage } from './pages/ProductsPage.js'
import { OrdersPage } from './pages/OrdersPage.js'
import { clearSession, getTenantId, getToken } from './api/client.js'

function ProtectedShell() {
  const navigate = useNavigate()
  if (!getToken()) return <Navigate to="/login" replace />
  const tenantId = getTenantId()
  return (
    <div className="shell">
      <header className="topbar">
        <nav>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/products" className={({ isActive }) => (isActive ? 'active' : '')}>
            Products
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Orders
          </NavLink>
        </nav>
        <div className="row">
          <span className="meta">tenant #{tenantId ?? '-'}</span>
          <button
            className="secondary"
            onClick={() => {
              clearSession()
              navigate('/login', { replace: true })
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedShell />} />
    </Routes>
  )
}
