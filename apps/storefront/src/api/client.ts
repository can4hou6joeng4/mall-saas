import type { components } from './types.gen.js'

export type AuthResult = components['schemas']['AuthResult']
export type Product = components['schemas']['Product']
export type ProductList = components['schemas']['ProductList']
export type Order = components['schemas']['Order']
export type CartItem = components['schemas']['CartItem']
export type ErrorResponse = components['schemas']['ErrorResponse']

const TOKEN_KEY = 'mall_storefront_token'
const REFRESH_KEY = 'mall_storefront_refresh_token'
const TENANT_KEY = 'mall_storefront_tenant_id'
const USER_KEY = 'mall_storefront_user_email'

export function getToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string): void {
  window.localStorage.setItem(TOKEN_KEY, t)
}

export function getRefreshToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(REFRESH_KEY)
}

export function setRefreshToken(t: string): void {
  window.localStorage.setItem(REFRESH_KEY, t)
}

export function getTenantId(): number | null {
  const v = typeof window === 'undefined' ? null : window.localStorage.getItem(TENANT_KEY)
  return v ? Number(v) : null
}

export function setTenantId(t: number): void {
  window.localStorage.setItem(TENANT_KEY, String(t))
}

export function getUserEmail(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(USER_KEY)
}

export function setUserEmail(e: string): void {
  window.localStorage.setItem(USER_KEY, e)
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_KEY)
  window.localStorage.removeItem(TENANT_KEY)
  window.localStorage.removeItem(USER_KEY)
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message)
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined>
}

const baseUrl = import.meta.env['VITE_API_BASE'] ?? ''

// 单飞 refresh：避免并发 401 引发多次刷新
let refreshInFlight: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) {
        clearSession()
        return false
      }
      const body = (await res.json()) as AuthResult
      setToken(body.accessToken)
      setRefreshToken(body.refreshToken)
      return true
    } catch {
      clearSession()
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`, window.location.origin)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = getToken()
  if (token) headers['authorization'] = `Bearer ${token}`
  const init: RequestInit = { method: opts.method ?? 'GET', headers }
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
  return fetch(url.toString(), init)
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, opts)
  // 401 + 不是 auth 路径自身 → 尝试刷新一次再重试
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      res = await rawRequest(path, opts)
    }
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const parsed = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const err = parsed as Partial<ErrorResponse> | null
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? `request failed: ${res.status}`,
      err?.requestId,
    )
  }
  return parsed as T
}

export const api = {
  register(tenantId: number, email: string, password: string): Promise<AuthResult> {
    return apiRequest('/auth/register', {
      method: 'POST',
      body: { tenantId, email, password },
    })
  },
  login(tenantId: number, email: string, password: string): Promise<AuthResult> {
    return apiRequest('/auth/login', {
      method: 'POST',
      body: { tenantId, email, password },
    })
  },
  listProducts(query: { page?: number; pageSize?: number }): Promise<ProductList> {
    return apiRequest('/products', { query })
  },
  getProduct(id: number): Promise<Product> {
    return apiRequest(`/products/${id}`)
  },
  // Cart
  listCart(): Promise<CartItem[]> {
    return apiRequest('/cart')
  },
  addCartItem(productId: number, quantity: number): Promise<CartItem> {
    return apiRequest('/cart/items', {
      method: 'POST',
      body: { productId, quantity },
    })
  },
  updateCartItem(productId: number, quantity: number): Promise<CartItem> {
    return apiRequest(`/cart/items/${productId}`, {
      method: 'PATCH',
      body: { quantity },
    })
  },
  removeCartItem(productId: number): Promise<void> {
    return apiRequest(`/cart/items/${productId}`, { method: 'DELETE' })
  },
  clearCart(): Promise<void> {
    return apiRequest('/cart', { method: 'DELETE' })
  },
  checkout(): Promise<Order> {
    return apiRequest('/cart/checkout', { method: 'POST' })
  },
  // Orders
  listOrders(): Promise<{ items: Order[]; total: number; page: number; pageSize: number }> {
    return apiRequest('/orders', { query: { page: 1, pageSize: 50 } })
  },
}
