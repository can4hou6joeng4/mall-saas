import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, api, getToken, setTenantId, setToken } from '../api/client.js'

export function LoginPage() {
  const navigate = useNavigate()
  const [tenantId, setTenantIdInput] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (getToken()) return <Navigate to="/dashboard" replace />

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const tid = Number(tenantId)
    if (!Number.isInteger(tid) || tid <= 0) {
      setError('tenantId 必须是正整数')
      return
    }
    setBusy(true)
    try {
      const res = await api.login(tid, email, password)
      setToken(res.accessToken)
      setTenantId(res.user.tenantId)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Mall Store</h1>
        <p className="muted">商家后台登录</p>
        <label>
          Tenant ID
          <input
            type="text"
            inputMode="numeric"
            value={tenantId}
            onChange={(e) => setTenantIdInput(e.target.value.replace(/[^0-9]/g, ''))}
            required
            autoFocus
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  )
}
