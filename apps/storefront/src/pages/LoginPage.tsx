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
import { useT } from '../i18n/index.js'

export function LoginPage() {
  const navigate = useNavigate()
  const t = useT()
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
      setError(t('login_invalid_tenant'))
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
      setError(
        err instanceof ApiError
          ? err.message
          : t(mode === 'register' ? 'login_failed_register' : 'login_failed_login'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>{t('login_title')}</h1>
        <p className="muted">
          {mode === 'register' ? t('login_register_subtitle') : t('login_login_subtitle')}
        </p>
        <label>
          {t('login_tenant_id')}
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
          {t('login_email')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          {t('login_password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : 1}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy
            ? t('login_submitting')
            : mode === 'register'
              ? t('login_submit_register')
              : t('login_submit_login')}
        </button>
        <div className="toggle">
          {mode === 'register' ? t('login_have_account') : t('login_no_account')}{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setError(null)
              setMode(mode === 'register' ? 'login' : 'register')
            }}
          >
            {mode === 'register' ? t('login_to_login') : t('login_to_register')}
          </a>
        </div>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  )
}
