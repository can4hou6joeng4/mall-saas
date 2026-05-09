import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  apiRequest,
  clearSession,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
} from '../src/api/client.js'

interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

describe('apiRequest 401 → refresh → retry', () => {
  beforeEach(() => {
    setToken('expired-access')
    setRefreshToken('valid-refresh')
  })

  afterEach(() => {
    clearSession()
    vi.unstubAllGlobals()
  })

  it('单 401：刷新成功后用新 token 重试，并落库新 refreshToken', async () => {
    const calls: { url: string; init: FetchInit | undefined }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        calls.push({ url, init })
        if (url.includes('/auth/refresh')) {
          return new Response(
            JSON.stringify({
              accessToken: 'fresh-access',
              refreshToken: 'fresh-refresh',
              user: { id: 1, tenantId: 9, email: 'm@example.com', role: 'admin' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        const auth = init?.headers?.['authorization']
        if (auth === 'Bearer expired-access') {
          return new Response(
            JSON.stringify({ code: 'UNAUTHORIZED', message: 'jwt expired' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        if (auth === 'Bearer fresh-access') {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('unexpected', { status: 500 })
      }),
    )

    const data = await apiRequest<{ ok: boolean }>('/store/dashboard')
    expect(data).toEqual({ ok: true })
    // 调用顺序：原请求(401) → /auth/refresh(200) → 原请求重试(200)
    expect(calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, ''))).toEqual([
      '/store/dashboard',
      '/auth/refresh',
      '/store/dashboard',
    ])
    expect(getToken()).toBe('fresh-access')
    expect(getRefreshToken()).toBe('fresh-refresh')
  })

  it('refresh 也失败：清空 session 并把原始 401 抛给调用方', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          return new Response(
            JSON.stringify({ code: 'UNAUTHORIZED', message: 'refresh expired' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: 'jwt expired' }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    await expect(apiRequest('/store/dashboard')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('并发 401：多个请求只触发一次 /auth/refresh（单飞）', async () => {
    let refreshCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: FetchInit) => {
        if (url.includes('/auth/refresh')) {
          refreshCount += 1
          // 给一点延迟模拟网络 RTT，便于并发触发
          await new Promise((r) => setTimeout(r, 20))
          return new Response(
            JSON.stringify({
              accessToken: 'fresh-access',
              refreshToken: 'fresh-refresh',
              user: { id: 1, tenantId: 9, email: 'm@example.com', role: 'admin' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        const auth = init?.headers?.['authorization']
        if (auth === 'Bearer fresh-access') {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: 'jwt expired' }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const results = await Promise.all([
      apiRequest<{ ok: boolean }>('/store/dashboard'),
      apiRequest<{ ok: boolean }>('/products'),
      apiRequest<{ ok: boolean }>('/store/orders'),
    ])
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(refreshCount).toBe(1)
  })

  it('/auth/* 自身 401 不会触发 refresh', async () => {
    let refreshCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshCount += 1
          return new Response('{}', { status: 200 })
        }
        return new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: 'bad password' }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(refreshCount).toBe(0)
  })
})
