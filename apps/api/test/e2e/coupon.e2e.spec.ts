import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Coupons + order discount (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let adminToken: string
  let userToken: string
  let productId = 0

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '900'
    process.env['JWT_REFRESH_TTL_SECONDS'] = '604800'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await owner.coupon.deleteMany({})
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [55])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    adminToken = await registerAndLogin(app, {
      tenantId: 55,
      email: 'admin@t55.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 55,
      email: 'shopper@t55.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Phone', priceCents: 10000, stock: 10 },
    })
    productId = (created.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
  })

  it('non-admin cannot create coupon (403)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(userToken),
      payload: { code: 'NOPE', discountType: 'PERCENT', discountValue: 10 },
    })
    expect(r.statusCode).toBe(403)
  })

  it('admin creates a PERCENT coupon and lists it', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(adminToken),
      payload: {
        code: 'SUMMER10',
        discountType: 'PERCENT',
        discountValue: 10,
        minOrderCents: 500,
        maxUsage: 2,
      },
    })
    expect(r.statusCode).toBe(201)
    const body = r.json() as { id: number; code: string }
    expect(body.code).toBe('SUMMER10')

    const list = await app.inject({
      method: 'GET',
      url: '/coupons',
      headers: bearer(adminToken),
    })
    expect((list.json() as { total: number }).total).toBeGreaterThanOrEqual(1)
  })

  it('rejects PERCENT discount > 100 with 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(adminToken),
      payload: { code: 'BAD', discountType: 'PERCENT', discountValue: 200 },
    })
    expect(r.statusCode).toBe(400)
  })

  it('user places order with coupon: subtotal/discount/total are computed correctly', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: {
        items: [{ productId, quantity: 2 }],
        couponCode: 'SUMMER10',
      },
    })
    expect(r.statusCode).toBe(201)
    const body = r.json() as {
      subtotalCents: number
      discountCents: number
      totalCents: number
      couponId: number | null
    }
    expect(body.subtotalCents).toBe(20000)
    expect(body.discountCents).toBe(2000)
    expect(body.totalCents).toBe(18000)
    expect(body.couponId).not.toBeNull()
  })

  it('order without coupon has zero discount and total = subtotal', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId, quantity: 1 }] },
    })
    const body = r.json() as { subtotalCents: number; discountCents: number; totalCents: number; couponId: number | null }
    expect(body.subtotalCents).toBe(10000)
    expect(body.discountCents).toBe(0)
    expect(body.totalCents).toBe(10000)
    expect(body.couponId).toBeNull()
  })

  it('coupon usageCount increments after order', async () => {
    const c = await owner.coupon.findUnique({
      where: { tenantId_code: { tenantId: 55, code: 'SUMMER10' } },
    })
    expect(c?.usageCount).toBeGreaterThanOrEqual(1)
  })

  it('coupon below minOrderCents is rejected (409)', async () => {
    await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(adminToken),
      payload: {
        code: 'BIG-MIN',
        discountType: 'AMOUNT',
        discountValue: 100,
        minOrderCents: 999999,
      },
    })
    const r = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: {
        items: [{ productId, quantity: 1 }],
        couponCode: 'BIG-MIN',
      },
    })
    expect(r.statusCode).toBe(409)
  })

  it('disabled coupon cannot be applied', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(adminToken),
      payload: { code: 'GONE', discountType: 'AMOUNT', discountValue: 50 },
    })
    const id = (created.json() as { id: number }).id
    await app.inject({
      method: 'PATCH',
      url: `/coupons/${id}/disable`,
      headers: bearer(adminToken),
    })
    const r = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: {
        items: [{ productId, quantity: 1 }],
        couponCode: 'GONE',
      },
    })
    expect(r.statusCode).toBe(409)
  })

  it('exceeding maxUsage is rejected (409)', async () => {
    // SUMMER10 maxUsage=2 — 已用过 1 次（前面的 happy path），再用一次到 2，再来一次应该 409
    const r1 = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: {
        items: [{ productId, quantity: 1 }],
        couponCode: 'SUMMER10',
      },
    })
    expect(r1.statusCode).toBe(201)
    const r2 = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: {
        items: [{ productId, quantity: 1 }],
        couponCode: 'SUMMER10',
      },
    })
    expect(r2.statusCode).toBe(409)
  })
})
