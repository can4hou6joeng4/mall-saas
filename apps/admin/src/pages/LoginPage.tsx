import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, api, getToken, setToken } from '../api/client.js'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (getToken()) return <Navigate to="/tenants" replace />

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.loginAdmin(email, password)
      setToken(res.accessToken)
      navigate('/tenants', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Mall Admin</h1>
        <p className="muted">平台超管登录</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
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
