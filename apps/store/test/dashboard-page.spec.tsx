import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DashboardPage } from '../src/pages/DashboardPage.js'
import { setToken, clearSession } from '../src/api/client.js'

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    setToken('fake-merchant-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/store/dashboard')) {
          return new Response(
            JSON.stringify({
              ordersByStatus: {
                pending: { count: 3, totalCents: 9999 },
                paid: { count: 2, totalCents: 12000 },
              },
              productCount: 17,
              lowStockProducts: 2,
              lowStockThreshold: 5,
              reservedStockTotal: 4,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    clearSession()
    vi.unstubAllGlobals()
  })

  it('renders dashboard cards and order buckets', async () => {
    render(withProviders(<DashboardPage />))
    await waitFor(() => expect(screen.getByText('17')).toBeInTheDocument())
    expect(screen.getByText('待支付')).toBeInTheDocument()
    expect(screen.getByText('已支付')).toBeInTheDocument()
    expect(screen.getByText('低库存（≤5）')).toBeInTheDocument()
  })
})
