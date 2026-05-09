import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage.js'
import { ProductsPage } from './pages/ProductsPage.js'
import { CartPage } from './pages/CartPage.js'
import { OrdersPage } from './pages/OrdersPage.js'
import { OrderDetailPage } from './pages/OrderDetailPage.js'
import { clearSession, getToken, getUserEmail } from './api/client.js'

function ProtectedShell() {
  const navigate = useNavigate()
  if (!getToken()) return <Navigate to="/login" replace />
  return (
    <div className="shell">
      <header className="topbar">
        <nav>
          <NavLink to="/products" className={({ isActive }) => (isActive ? 'active' : '')}>
            商品
          </NavLink>
          <NavLink to="/cart" className={({ isActive }) => (isActive ? 'active' : '')}>
            购物车
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            我的订单
          </NavLink>
        </nav>
        <div className="row">
          <span className="meta">{getUserEmail() ?? ''}</span>
          <button
            className="secondary"
            onClick={() => {
              clearSession()
              navigate('/login', { replace: true })
            }}
          >
            登出
          </button>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/products" replace />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="*" element={<Navigate to="/products" replace />} />
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
