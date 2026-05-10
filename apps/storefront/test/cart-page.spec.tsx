import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CartPage } from '../src/pages/CartPage.js'
import { setToken, clearSession } from '../src/api/client.js'

interface FetchInit {
  method?: string
  body?: string
}

function withProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cart']}>
        <Routes>
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<div>orders mock</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const CART = [
  {
    id: 1,
    tenantId: 9,
    userId: 7,
    productId: 21,
    quantity: 2,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
]
const PRODUCTS = {
  items: [
    {
      id: 21,
      tenantId: 9,
      name: 'Book',
      priceCents: 1000,
      stock: 10,
      reservedStock: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 100,
}

describe('storefront CartPage', () => {
  beforeEach(() => {
    setToken('fake-user-token')
  })

  afterEach(() => {
    cleanup()
    clearSession()
    vi.unstubAllGlobals()
  })

  it('checkout sends couponCode in body when input filled', async () => {
    let checkoutBody: unknown = undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/cart/checkout') && init?.method === 'POST') {
          checkoutBody = JSON.parse(init.body ?? '{}')
          return new Response(
            JSON.stringify({
              id: 999,
              tenantId: 9,
              userId: 7,
              status: 'pending',
              subtotalCents: 2000,
              discountCents: 500,
              totalCents: 1500,
              couponId: 1,
              items: [],
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.includes('/cart')) {
          return new Response(JSON.stringify(CART), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.includes('/products')) {
          return new Response(JSON.stringify(PRODUCTS), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(withProviders())
    await waitFor(() => expect(screen.getByText('Book')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('优惠券'), { target: { value: 'SAVE5' } })
    fireEvent.click(screen.getByRole('button', { name: '结算' }))

    await waitFor(() => expect(checkoutBody).toEqual({ couponCode: 'SAVE5' }))
    await waitFor(() =>
      expect(screen.getByText(/下单成功，订单 #999.*优惠 ¥ 5\.00/)).toBeInTheDocument(),
    )
  })

  it('checkout sends empty body when no coupon entered', async () => {
    let checkoutBody: unknown = undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/cart/checkout') && init?.method === 'POST') {
          checkoutBody = JSON.parse(init.body ?? '{}')
          return new Response(
            JSON.stringify({
              id: 1000,
              tenantId: 9,
              userId: 7,
              status: 'pending',
              subtotalCents: 2000,
              discountCents: 0,
              totalCents: 2000,
              couponId: null,
              items: [],
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.includes('/cart')) {
          return new Response(JSON.stringify(CART), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.includes('/products')) {
          return new Response(JSON.stringify(PRODUCTS), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(withProviders())
    await waitFor(() => expect(screen.getByText('Book')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '结算' }))
    await waitFor(() => expect(checkoutBody).toEqual({}))
  })
})
