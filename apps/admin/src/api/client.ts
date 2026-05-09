import type { components } from './types.gen.js'

export type AuthResult = components['schemas']['AuthResult']
export type Tenant = components['schemas']['Tenant']
export type TenantDetail = components['schemas']['TenantDetail']
export type Order = components['schemas']['Order']
export type Payment = components['schemas']['Payment']
export type PaymentDetail = components['schemas']['PaymentDetail']
export type ErrorResponse = components['schemas']['ErrorResponse']

interface PaginatedList<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

const TOKEN_KEY = 'mall_admin_token'

export function getToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY)
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

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${baseUrl}${path}`, window.location.origin)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = getToken()
  if (token) headers['authorization'] = `Bearer ${token}`

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  }
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
  const res = await fetch(url.toString(), init)
  if (res.status === 401 && !path.startsWith('/admin/auth/')) {
    // platform 端无 refreshToken：直接清 token，下一次渲染由 ProtectedShell 跳回 /login
    clearToken()
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
  loginAdmin(email: string, password: string): Promise<AuthResult> {
    return apiRequest('/admin/auth/login', { method: 'POST', body: { email, password } })
  },
  listTenants(): Promise<Tenant[]> {
    return apiRequest('/admin/tenants')
  },
  getTenant(id: number): Promise<TenantDetail> {
    return apiRequest(`/admin/tenants/${id}`)
  },
  createTenant(name: string): Promise<Tenant> {
    return apiRequest('/admin/tenants', { method: 'POST', body: { name } })
  },
  listOrders(query: {
    page?: number
    pageSize?: number
    tenantId?: number
    status?: string
  }): Promise<PaginatedList<Order>> {
    return apiRequest('/admin/orders', { query })
  },
  listPayments(query: {
    page?: number
    pageSize?: number
    tenantId?: number
    status?: string
  }): Promise<PaginatedList<Payment>> {
    return apiRequest('/admin/payments', { query })
  },
  getPayment(id: number): Promise<PaymentDetail> {
    return apiRequest(`/admin/payments/${id}`)
  },
}

export type { PaginatedList }
