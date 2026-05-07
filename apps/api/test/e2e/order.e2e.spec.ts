import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Orders API (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let adminToken: string
  let userToken: string
  let phoneId = 0
  let scarceId = 0

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '3600'
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [11])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    adminToken = await registerAndLogin(app, {
      tenantId: 11,
      email: 'admin@t11.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 11,
      email: 'user@t11.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const phoneRes = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Phone', priceCents: 9999, stock: 10 },
    })
    phoneId = (phoneRes.json() as { id: number }).id

    const scarceRes = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Scarce', priceCents: 5000, stock: 1 },
    })
    scarceId = (scarceRes.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('user creates an order successfully and stock is reserved (not yet decremented)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId: phoneId, quantity: 2 }] },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as {
      id: number
      status: string
      totalCents: number
      items: { productId: number; quantity: number; subtotalCents: number }[]
    }
    expect(body.status).toBe('pending')
    expect(body.totalCents).toBe(2 * 9999)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.quantity).toBe(2)

    // 预占语义：stock 不变，reservedStock 增加
    const phone = await owner.product.findUnique({ where: { id: phoneId } })
    expect(phone?.stock).toBe(10)
    expect(phone?.reservedStock).toBe(2)
  })

  it('rejects ordering more than available stock with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId: phoneId, quantity: 9999 }] },
    })
    expect(res.statusCode).toBe(409)
    const body = res.json() as Record<string, unknown>
    expect(body['code']).toBe('CONFLICT')
  })

  it('rejects ordering an unknown product with 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId: 999999, quantity: 1 }] },
    })
    expect(res.statusCode).toBe(404)
  })

  it('two concurrent orders for the last unit: exactly one succeeds', async () => {
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/orders',
        headers: bearer(userToken),
        payload: { items: [{ productId: scarceId, quantity: 1 }] },
      }),
      app.inject({
        method: 'POST',
        url: '/orders',
        headers: bearer(userToken),
        payload: { items: [{ productId: scarceId, quantity: 1 }] },
      }),
    ])
    const codes = [r1.statusCode, r2.statusCode].sort()
    expect(codes).toEqual([201, 409])
    const scarce = await owner.product.findUnique({ where: { id: scarceId } })
    // 预占语义：stock 仍是 1（未真扣），reservedStock 变成 1（被那笔成功的订单占住）
    expect(scarce?.stock).toBe(1)
    expect(scarce?.reservedStock).toBe(1)
  })

  it('user can list and fetch their own orders', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/orders',
      headers: bearer(userToken),
    })
    expect(list.statusCode).toBe(200)
    const body = list.json() as { items: { id: number }[]; total: number }
    expect(body.total).toBeGreaterThanOrEqual(1)

    const orderId = body.items[0]!.id
    const detail = await app.inject({
      method: 'GET',
      url: `/orders/${orderId}`,
      headers: bearer(userToken),
    })
    expect(detail.statusCode).toBe(200)
  })

  it('cancelling a pending order releases reserved stock and sets status', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId: phoneId, quantity: 3 }] },
    })
    expect(create.statusCode).toBe(201)
    const orderId = (create.json() as { id: number }).id

    const before = await owner.product.findUnique({ where: { id: phoneId } })

    const cancel = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/cancel`,
      headers: bearer(userToken),
    })
    expect(cancel.statusCode).toBe(200)
    expect((cancel.json() as { status: string }).status).toBe('cancelled')

    const after = await owner.product.findUnique({ where: { id: phoneId } })
    // stock 全程不动（pending 阶段从未真扣），reservedStock 应回到取消前 -3
    expect(after!.stock).toBe(before!.stock)
    expect(after!.reservedStock).toBe(before!.reservedStock - 3)

    const again = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/cancel`,
      headers: bearer(userToken),
    })
    expect(again.statusCode).toBe(409)
  })
})
