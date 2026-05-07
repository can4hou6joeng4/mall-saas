import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TenantsPage } from '../src/pages/TenantsPage.js'
import { setToken, clearToken } from '../src/api/client.js'

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tenants']}>
        <Routes>
          <Route path="/tenants" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TenantsPage', () => {
  beforeEach(() => {
    setToken('fake-test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/admin/tenants') && (!('method' in {}) || true)) {
          return new Response(
            JSON.stringify([
              { id: 1, name: 'Acme', createdAt: '2026-01-01T00:00:00Z' },
              { id: 2, name: 'Globex', createdAt: '2026-01-02T00:00:00Z' },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    clearToken()
    vi.unstubAllGlobals()
  })

  it('renders the list of tenants returned by the API', async () => {
    render(withProviders(<TenantsPage />))
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument())
    expect(screen.getByText('Globex')).toBeInTheDocument()
  })
})
