import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../build.js'

const expectedPaths = [
  '/healthz',
  '/readyz',
  '/metrics',
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/products',
  '/products/{id}',
  '/orders',
  '/orders/{id}',
  '/orders/{id}/cancel',
  '/orders/{id}/pay',
  '/webhooks/payments/{provider}',
  '/cart',
  '/cart/items',
  '/cart/items/{productId}',
  '/cart/checkout',
  '/coupons',
  '/coupons/{id}/disable',
  '/store/orders',
  '/store/orders/{id}',
  '/store/orders/{id}/ship',
  '/store/dashboard',
  '/admin/auth/login',
  '/admin/tenants',
  '/admin/tenants/{id}',
  '/admin/orders',
  '/admin/payments',
  '/admin/payments/{id}',
]

const expectedSchemas = [
  'ErrorResponse',
  'AuthResult',
  'RegisterRequest',
  'LoginRequest',
  'Product',
  'ProductList',
  'CreateProductRequest',
  'UpdateProductRequest',
  'Order',
  'OrderItem',
  'CreateOrderRequest',
  'Payment',
  'PayOrderRequest',
  'Tenant',
  'AdminLoginRequest',
  'CreateTenantRequest',
  'UpdateTenantRequest',
]

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument()

  it('has the expected meta', () => {
    expect(doc.openapi).toBe('3.0.0')
    expect(doc.info.title).toBe('Mall API')
  })

  it('declares bearerAuth security scheme', () => {
    const components = doc.components as { securitySchemes?: Record<string, unknown> }
    expect(components.securitySchemes?.['bearerAuth']).toBeDefined()
  })

  it('contains all expected paths', () => {
    const actual = Object.keys(doc.paths).sort()
    for (const p of expectedPaths) {
      expect(actual, `missing path ${p}`).toContain(p)
    }
  })

  it('contains all expected schemas', () => {
    const components = doc.components as { schemas?: Record<string, unknown> }
    const actual = Object.keys(components.schemas ?? {})
    for (const s of expectedSchemas) {
      expect(actual, `missing schema ${s}`).toContain(s)
    }
  })

  it('admin paths require security', () => {
    const ops = (doc.paths['/admin/tenants'] as Record<string, { security?: unknown[] }>) ?? {}
    expect(ops['get']?.security).toBeDefined()
    expect(ops['post']?.security).toBeDefined()
  })

  it('public paths do NOT require security', () => {
    const ops = doc.paths['/healthz'] as Record<string, { security?: unknown[] }>
    expect(ops['get']?.security).toBeUndefined()
  })
})
