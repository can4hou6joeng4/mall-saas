import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { OrderDetailPage } from '../src/pages/OrderDetailPage.js'
import { setToken, clearSession } from '../src/api/client.js'

function withProviders(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('OrderDetailPage', () => {
  beforeEach(() => {
    setToken('fake-merchant-token')
  })

  afterEach(() => {
    cleanup()
    clearSession()
    vi.unstubAllGlobals()
  })

  it('renders user / items / coupon discount / payment row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/store/orders/123')) {
          return new Response(
            JSON.stringify({
              id: 123,
              tenantId: 9,
              userId: 7,
              status: 'paid',
              subtotalCents: 5000,
              discountCents: 200,
              totalCents: 4800,
              couponId: 1,
              items: [
                {
                  id: 1,
                  orderId: 123,
                  productId: 42,
                  quantity: 2,
                  unitPriceCents: 2500,
                  subtotalCents: 5000,
                },
              ],
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
              user: { id: 7, email: 'shopper@example.com' },
              coupon: {
                id: 1,
                code: 'SAVE10',
                discountType: 'AMOUNT',
                discountValue: 200,
                minOrderCents: 0,
              },
              payments: [
                {
                  id: 11,
                  providerName: 'mock',
                  providerRef: 'pi_test_xyz',
                  amountCents: 4800,
                  status: 'succeeded',
                  createdAt: '2026-05-01T00:01:00.000Z',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(withProviders('/orders/123'))
    await waitFor(() => expect(screen.getByText('订单 #123')).toBeInTheDocument())
    expect(screen.getByText('shopper@example.com', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('已支付')).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByText('SAVE10', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('-¥2.00')).toBeInTheDocument()
    expect(screen.getAllByText('¥48.00').length).toBeGreaterThan(0)
    expect(screen.getByText('pi_test_xyz')).toBeInTheDocument()
    // paid 状态下渲染发货按钮
    expect(screen.getByRole('button', { name: '发货' })).toBeEnabled()
  })

  it('shows "暂无支付记录" when payments=[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 200,
              tenantId: 9,
              userId: 7,
              status: 'pending',
              subtotalCents: 1000,
              discountCents: 0,
              totalCents: 1000,
              couponId: null,
              items: [],
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
              user: { id: 7, email: 'a@b.dev' },
              coupon: null,
              payments: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    render(withProviders('/orders/200'))
    await waitFor(() => expect(screen.getByText('订单 #200')).toBeInTheDocument())
    expect(screen.getByText('暂无支付记录')).toBeInTheDocument()
    // pending 状态不展示发货按钮
    expect(screen.queryByRole('button', { name: '发货' })).toBeNull()
  })
})
