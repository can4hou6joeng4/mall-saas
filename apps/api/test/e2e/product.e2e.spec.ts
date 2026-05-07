import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Products API (e2e, tenant-isolated)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let token1: string
  let token2: string
  let userToken1: string

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '3600'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [1, 2])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    token1 = await registerAndLogin(app, {
      tenantId: 1,
      email: 'admin@t1.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    token2 = await registerAndLogin(app, {
      tenantId: 2,
      email: 'admin@t2.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken1 = await registerAndLogin(app, {
      tenantId: 1,
      email: 'user@t1.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  let tenant1ProductId = 0

  it('rejects creating a product without Authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      payload: { name: 'Phone', priceCents: 9999 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects invalid payload with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(token1),
      payload: { name: '', priceCents: -1 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates a product for tenant 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(token1),
      payload: { name: 'Phone', priceCents: 9999, stock: 10 },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { id: number; tenantId: number; name: string }
    expect(body.tenantId).toBe(1)
    expect(body.name).toBe('Phone')
    tenant1ProductId = body.id
  })

  it('tenant 1 sees its product in the list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: bearer(token1),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: { id: number }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.id).toBe(tenant1ProductId)
  })

  it('tenant 2 sees an empty list (RLS isolated)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: bearer(token2),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: unknown[]; total: number }
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })

  it('tenant 2 cannot fetch tenant 1 product by id (404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/products/${tenant1ProductId}`,
      headers: bearer(token2),
    })
    expect(res.statusCode).toBe(404)
  })

  it('tenant 1 can update its own product', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/products/${tenant1ProductId}`,
      headers: bearer(token1),
      payload: { stock: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { stock: number }).stock).toBe(5)
  })

  it('tenant 2 cannot update tenant 1 product (404)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/products/${tenant1ProductId}`,
      headers: bearer(token2),
      payload: { stock: 0 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('tenant 1 can delete its own product', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/products/${tenant1ProductId}`,
      headers: bearer(token1),
    })
    expect(res.statusCode).toBe(204)
  })

  it('user role can list products (no role required for GET)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: bearer(userToken1),
    })
    expect(res.statusCode).toBe(200)
  })

  it('user role is forbidden from creating products (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(userToken1),
      payload: { name: 'Forbidden', priceCents: 1 },
    })
    expect(res.statusCode).toBe(403)
    const body = res.json() as Record<string, unknown>
    expect(body['code']).toBe('FORBIDDEN')
  })
})
