import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProductsPage } from '../src/pages/ProductsPage.js'
import { setToken, clearSession } from '../src/api/client.js'

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/products']}>
        <Routes>
          <Route path="/products" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ProductsPage', () => {
  beforeEach(() => {
    setToken('fake-storefront-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/products')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 1,
                  tenantId: 1,
                  categoryId: null,
                  name: 'Phone',
                  priceCents: 9900,
                  stock: 5,
                  reservedStock: 1,
                  createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-01T00:00:00Z',
                },
                {
                  id: 2,
                  tenantId: 1,
                  categoryId: null,
                  name: 'Sold Out',
                  priceCents: 5000,
                  stock: 1,
                  reservedStock: 1,
                  createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-01T00:00:00Z',
                },
              ],
              total: 2,
              page: 1,
              pageSize: 50,
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

  it('shows products with available stock and disables sold-out items', async () => {
    render(withProviders(<ProductsPage />))
    await waitFor(() => expect(screen.getByText('Phone')).toBeInTheDocument())
    expect(screen.getByText('Sold Out')).toBeInTheDocument()
    expect(screen.getByText(/已售罄/)).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '加入购物车' })
    expect(buttons[0]).not.toBeDisabled() // Phone has 4 available
    expect(buttons[1]).toBeDisabled() // Sold Out
  })
})
