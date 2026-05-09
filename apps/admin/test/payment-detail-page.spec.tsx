import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PaymentDetailPage } from '../src/pages/PaymentDetailPage.js'
import { setToken, clearToken } from '../src/api/client.js'

function withProviders(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/payments/:id" element={<PaymentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('admin PaymentDetailPage', () => {
  beforeEach(() => {
    setToken('fake-platform-token')
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('renders payment + order(items) + tenant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/admin/payments/55')) {
          return new Response(
            JSON.stringify({
              id: 55,
              tenantId: 9,
              orderId: 700,
              providerName: 'mock',
              providerRef: 'mock_55_xyz',
              amountCents: 4800,
              status: 'succeeded',
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:01:00.000Z',
              order: {
                id: 700,
                tenantId: 9,
                userId: 7,
                status: 'paid',
                subtotalCents: 5000,
                discountCents: 200,
                totalCents: 4800,
                couponId: null,
                items: [
                  {
                    id: 1,
                    orderId: 700,
                    productId: 21,
                    quantity: 2,
                    unitPriceCents: 2500,
                    subtotalCents: 5000,
                  },
                ],
                createdAt: '2026-05-01T00:00:00.000Z',
                updatedAt: '2026-05-01T00:00:00.000Z',
              },
              tenant: {
                id: 9,
                name: 'Acme Inc',
                createdAt: '2026-04-01T00:00:00.000Z',
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
    render(withProviders('/payments/55'))
    await waitFor(() => expect(screen.getByText('支付 #55')).toBeInTheDocument())
    expect(screen.getByText('mock_55_xyz')).toBeInTheDocument()
    expect(screen.getByText('succeeded')).toBeInTheDocument()
    expect(screen.getByText('#9 Acme Inc')).toBeInTheDocument()
    expect(screen.getByText('#700')).toBeInTheDocument()
    expect(screen.getByText('#21')).toBeInTheDocument()
    expect(screen.getByText('已支付')).toBeInTheDocument()
  })
})
