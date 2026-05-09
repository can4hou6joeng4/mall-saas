import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { UsersPage } from '../src/pages/UsersPage.js'
import { setToken, clearToken } from '../src/api/client.js'

interface FetchInit {
  method?: string
  body?: string
}

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/users" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const SAMPLE_USERS = [
  {
    id: 1,
    tenantId: 9,
    email: 'a@example.com',
    role: 'admin',
    locked: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 2,
    tenantId: 9,
    email: 'u@example.com',
    role: 'user',
    locked: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
]

describe('admin UsersPage', () => {
  beforeEach(() => {
    setToken('fake-platform-token')
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('renders user list with active/locked pills', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ items: SAMPLE_USERS, total: 2, page: 1, pageSize: 50 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    render(withProviders(<UsersPage />))
    await waitFor(() => expect(screen.getByText('a@example.com')).toBeInTheDocument())
    expect(screen.getByText('u@example.com')).toBeInTheDocument()
    // active/locked 在 select option 和 status pill 都出现，用 getAllByText 不严格断言唯一
    expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('locked').length).toBeGreaterThanOrEqual(1)
    // 一个 active → "锁定" button；一个 locked → "解锁" button
    expect(screen.getByRole('button', { name: '锁定' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '解锁' })).toBeEnabled()
  })

  it('clicking 锁定 issues PATCH /admin/users/:id/lock with locked=true', async () => {
    let lockPayload: { url: string; body: unknown } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/admin/users/1/lock') && init?.method === 'PATCH') {
          lockPayload = { url, body: JSON.parse(init.body ?? '{}') }
          return new Response(
            JSON.stringify({ ...SAMPLE_USERS[0], locked: true }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({ items: SAMPLE_USERS, total: 2, page: 1, pageSize: 50 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    render(withProviders(<UsersPage />))
    await waitFor(() => expect(screen.getByText('a@example.com')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '锁定' }))
    await waitFor(() =>
      expect(lockPayload).toMatchObject({ body: { locked: true } }),
    )
  })

  it('clicking 重置密码 confirms + shows one-time password', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/admin/users/1/reset-password') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              user: SAMPLE_USERS[0],
              temporaryPassword: 'TmpPw_abc123XY',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({ items: SAMPLE_USERS, total: 2, page: 1, pageSize: 50 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    render(withProviders(<UsersPage />))
    await waitFor(() => expect(screen.getByText('a@example.com')).toBeInTheDocument())
    // a@example.com 那行的"重置密码"
    const resetButtons = screen.getAllByRole('button', { name: '重置密码' })
    fireEvent.click(resetButtons[0]!)
    await waitFor(() => expect(screen.getByText('TmpPw_abc123XY')).toBeInTheDocument())
    expect(screen.getByText('临时密码已生成', { exact: false })).toBeInTheDocument()
  })
})
