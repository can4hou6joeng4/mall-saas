import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nProvider } from '../src/i18n/index.js'
import { LoginPage } from '../src/pages/LoginPage.js'
import { clearSession } from '../src/api/client.js'

const LOCALE_KEY = 'mall_storefront_locale'

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <I18nProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>
  )
}

describe('storefront i18n', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LOCALE_KEY)
  })

  afterEach(() => {
    cleanup()
    clearSession()
    vi.unstubAllGlobals()
  })

  it('default locale is zh-CN; LoginPage shows 登录', () => {
    render(withProviders(<LoginPage />))
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByText('已有账号，欢迎回来')).toBeInTheDocument()
  })

  it('locale=en in localStorage → LoginPage shows English', () => {
    window.localStorage.setItem(LOCALE_KEY, 'en')
    render(withProviders(<LoginPage />))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('invalid tenant id error message follows current locale', async () => {
    window.localStorage.setItem(LOCALE_KEY, 'en')
    render(withProviders(<LoginPage />))
    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.dev' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('tenantId must be a positive integer')).toBeInTheDocument()
  })
})
