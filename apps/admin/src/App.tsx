import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage.js'
import { TenantsPage } from './pages/TenantsPage.js'
import { OrdersPage } from './pages/OrdersPage.js'
import { PaymentsPage } from './pages/PaymentsPage.js'
import { clearToken, getToken } from './api/client.js'

function ProtectedShell() {
  const navigate = useNavigate()
  if (!getToken()) return <Navigate to="/login" replace />
  return (
    <div className="shell">
      <header className="topbar">
        <nav>
          <NavLink to="/tenants" className={({ isActive }) => (isActive ? 'active' : '')}>
            Tenants
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Orders
          </NavLink>
          <NavLink to="/payments" className={({ isActive }) => (isActive ? 'active' : '')}>
            Payments
          </NavLink>
        </nav>
        <button
          className="secondary"
          onClick={() => {
            clearToken()
            navigate('/login', { replace: true })
          }}
        >
          Logout
        </button>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/tenants" replace />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="*" element={<Navigate to="/tenants" replace />} />
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
