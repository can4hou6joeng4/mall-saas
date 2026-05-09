import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  ApiError,
  api,
  getToken,
  setRefreshToken,
  setTenantId,
  setToken,
  setUserEmail,
} from '../api/client.js'

export function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [tenantId, setTenantIdInput] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (getToken()) return <Navigate to="/products" replace />

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
      const res =
        mode === 'register'
          ? await api.register(tid, email, password)
          : await api.login(tid, email, password)
      setToken(res.accessToken)
      setRefreshToken(res.refreshToken)
      setTenantId(res.user.tenantId)
      setUserEmail(res.user.email)
      navigate('/products', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${mode} failed`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Mall Storefront</h1>
        <p className="muted">{mode === 'register' ? '新用户注册' : '已有账号，欢迎回来'}</p>
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
            minLength={mode === 'register' ? 8 : 1}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '处理中…' : mode === 'register' ? '注册并登录' : '登录'}
        </button>
        <div className="toggle">
          {mode === 'register' ? '已经有账号？' : '还没有账号？'}{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setError(null)
              setMode(mode === 'register' ? 'login' : 'register')
            }}
          >
            {mode === 'register' ? '去登录' : '去注册'}
          </a>
        </div>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  )
}
