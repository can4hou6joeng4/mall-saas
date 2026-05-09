import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { OrderDetailPage } from '../src/pages/OrderDetailPage.js'
import { setToken, clearSession } from '../src/api/client.js'

interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

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

const PENDING_ORDER = {
  id: 555,
  tenantId: 9,
  userId: 7,
  status: 'pending' as const,
  subtotalCents: 4000,
  discountCents: 500,
  totalCents: 3500,
  couponId: null,
  items: [
    {
      id: 1,
      orderId: 555,
      productId: 21,
      quantity: 2,
      unitPriceCents: 2000,
      subtotalCents: 4000,
    },
  ],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
}

describe('storefront OrderDetailPage', () => {
  beforeEach(() => {
    setToken('fake-user-token')
  })

  afterEach(() => {
    cleanup()
    clearSession()
    vi.unstubAllGlobals()
  })

  it('renders order summary + 支付 button on pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(PENDING_ORDER), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    render(withProviders('/orders/555'))
    await waitFor(() => expect(screen.getByText('订单 #555')).toBeInTheDocument())
    expect(screen.getByText('待支付')).toBeInTheDocument()
    expect(screen.getByText('#21')).toBeInTheDocument()
    expect(screen.getByText('- ¥ 5.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去支付' })).toBeEnabled()
  })

  it('clicking 去支付 issues POST /orders/:id/pay with provider=mock', async () => {
    let payCalled: { url: string; body: unknown } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/orders/555/pay') && init?.method === 'POST') {
          payCalled = { url, body: JSON.parse(init.body ?? '{}') }
          return new Response(
            JSON.stringify({
              id: 1,
              tenantId: 9,
              orderId: 555,
              providerName: 'mock',
              providerRef: 'pi_mock_xyz',
              amountCents: 3500,
              status: 'pending',
              createdAt: '2026-05-08T00:00:00.000Z',
              updatedAt: '2026-05-08T00:00:00.000Z',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(PENDING_ORDER), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    render(withProviders('/orders/555'))
    await waitFor(() => expect(screen.getByRole('button', { name: '去支付' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '去支付' }))
    await waitFor(() =>
      expect(payCalled).toMatchObject({
        body: { provider: 'mock' },
      }),
    )
    // 按钮 disabled 后文案变成 "支付已发起，等待回调…"
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '支付已发起，等待回调…' })).toBeDisabled(),
    )
  })

  it('paid order does not render 支付 button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ...PENDING_ORDER, id: 600, status: 'paid' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    render(withProviders('/orders/600'))
    await waitFor(() => expect(screen.getByText('订单 #600')).toBeInTheDocument())
    expect(screen.getByText('已支付')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '去支付' })).toBeNull()
  })
})
