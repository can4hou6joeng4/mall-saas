import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TenantDetailPage } from '../src/pages/TenantDetailPage.js'
import { setToken, clearToken } from '../src/api/client.js'

function withProviders(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('admin TenantDetailPage', () => {
  beforeEach(() => {
    setToken('fake-platform-token')
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('renders tenant metadata + counts + ordersByStatus + paid revenue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/admin/tenants/42')) {
          return new Response(
            JSON.stringify({
              id: 42,
              name: 'Acme Inc',
              createdAt: '2026-05-01T00:00:00.000Z',
              productCount: 12,
              userCount: 4,
              paidRevenueCents: 12345,
              ordersByStatus: {
                pending: { count: 3, totalCents: 5000 },
                paid: { count: 2, totalCents: 12345 },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
    render(withProviders('/tenants/42'))
    await waitFor(() =>
      expect(screen.getByText('Acme Inc（#42）')).toBeInTheDocument(),
    )
    expect(screen.getByText('12')).toBeInTheDocument() // productCount
    expect(screen.getByText('4')).toBeInTheDocument() // userCount
    expect(screen.getAllByText('¥ 123.45').length).toBeGreaterThan(0) // paid revenue + paid bucket
    expect(screen.getByText('待支付')).toBeInTheDocument()
    expect(screen.getByText('已支付')).toBeInTheDocument()
  })

  it('shows "尚无订单" when ordersByStatus is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 99,
              name: 'Empty Co',
              createdAt: '2026-05-01T00:00:00.000Z',
              productCount: 0,
              userCount: 1,
              paidRevenueCents: 0,
              ordersByStatus: {},
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    render(withProviders('/tenants/99'))
    await waitFor(() => expect(screen.getByText('Empty Co（#99）')).toBeInTheDocument())
    expect(screen.getByText('尚无订单')).toBeInTheDocument()
  })
})
