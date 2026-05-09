import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CouponsPage } from '../src/pages/CouponsPage.js'
import { setToken, clearSession } from '../src/api/client.js'

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/coupons']}>
        <Routes>
          <Route path="/coupons" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

interface FetchInit {
  method?: string
  body?: string
}

describe('CouponsPage', () => {
  beforeEach(() => {
    setToken('fake-merchant-token')
  })

  afterEach(() => {
    cleanup()
    clearSession()
    vi.unstubAllGlobals()
  })

  it('lists coupons and submits create form', async () => {
    let createPayload: unknown = null
    let listCallCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/coupons') && (init?.method ?? 'GET') === 'GET') {
          listCallCount += 1
          // 第一次返回空，第二次（创建后 invalidate）返回新建的
          if (listCallCount === 1) {
            return new Response(
              JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )
          }
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 99,
                  tenantId: 9,
                  code: 'NEW10',
                  discountType: 'AMOUNT',
                  discountValue: 1000,
                  minOrderCents: 0,
                  maxUsage: 0,
                  usageCount: 0,
                  status: 'active',
                  expiresAt: null,
                  createdAt: '2026-05-08T00:00:00.000Z',
                  updatedAt: '2026-05-08T00:00:00.000Z',
                },
              ],
              total: 1,
              page: 1,
              pageSize: 50,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.includes('/coupons') && init?.method === 'POST') {
          createPayload = JSON.parse(init.body ?? '{}')
          return new Response(
            JSON.stringify({
              id: 99,
              tenantId: 9,
              code: 'NEW10',
              discountType: 'AMOUNT',
              discountValue: 1000,
              minOrderCents: 0,
              maxUsage: 0,
              usageCount: 0,
              status: 'active',
              expiresAt: null,
              createdAt: '2026-05-08T00:00:00.000Z',
              updatedAt: '2026-05-08T00:00:00.000Z',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(withProviders(<CouponsPage />))
    await waitFor(() => expect(screen.getByText('暂无优惠券')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'NEW10' } })
    fireEvent.change(screen.getByLabelText('数值'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createPayload).toMatchObject({ code: 'NEW10', discountValue: 1000 }))
    await waitFor(() => expect(screen.getByText('NEW10')).toBeInTheDocument())
  })
})
