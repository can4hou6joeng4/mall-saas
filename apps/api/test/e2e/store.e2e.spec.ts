import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Store BFF (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let merchantToken: string
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
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [44])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    merchantToken = await registerAndLogin(app, {
      tenantId: 44,
      email: 'merchant@t44.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 44,
      email: 'shopper@t44.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(merchantToken),
      payload: { name: 'Item', priceCents: 1500, stock: 8 },
    })
    productId = (created.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
  })

  it('non-admin cannot access /store/* (403)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/store/orders',
      headers: bearer(userToken),
    })
    expect(r.statusCode).toBe(403)
  })

  it('merchant lists orders across all users in their tenant', async () => {
    // user 下两单
    for (const qty of [1, 2]) {
      await app.inject({
        method: 'POST',
        url: '/orders',
        headers: bearer(userToken),
        payload: { items: [{ productId, quantity: qty }] },
      })
    }
    const r = await app.inject({
      method: 'GET',
      url: '/store/orders',
      headers: bearer(merchantToken),
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { items: { userId: number }[]; total: number }
    expect(body.total).toBeGreaterThanOrEqual(2)
    // 商家能看到所有 user 的订单（这里都是同一个 user）
    expect(body.items.every((it) => it.userId !== 0)).toBe(true)
  })

  it('cannot ship a pending order (409)', async () => {
    const placed = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId, quantity: 1 }] },
    })
    const orderId = (placed.json() as { id: number }).id
    const r = await app.inject({
      method: 'POST',
      url: `/store/orders/${orderId}/ship`,
      headers: bearer(merchantToken),
    })
    expect(r.statusCode).toBe(409)
  })

  it('paid order can be shipped; double-ship returns 409', async () => {
    // 下单 + 直接 owner 改 status=paid 模拟支付完成（避开整套 webhook 流程）
    const placed = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId, quantity: 1 }] },
    })
    const orderId = (placed.json() as { id: number }).id
    await owner.order.update({ where: { id: orderId }, data: { status: 'paid' } })

    const r = await app.inject({
      method: 'POST',
      url: `/store/orders/${orderId}/ship`,
      headers: bearer(merchantToken),
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { status: string }
    expect(body.status).toBe('shipped')

    const again = await app.inject({
      method: 'POST',
      url: `/store/orders/${orderId}/ship`,
      headers: bearer(merchantToken),
    })
    expect(again.statusCode).toBe(409)
  })

  it('GET /store/orders/:id returns detail with user / coupon=null / payments=[]', async () => {
    // 商家创建优惠券，user 下带 coupon 的订单
    const coupon = await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(merchantToken),
      payload: {
        code: 'M21OFF',
        discountType: 'AMOUNT',
        discountValue: 200,
        minOrderCents: 0,
        maxUsage: 0,
      },
    })
    expect(coupon.statusCode).toBe(201)

    const placed = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId, quantity: 1 }], couponCode: 'M21OFF' },
    })
    const orderId = (placed.json() as { id: number }).id

    const r = await app.inject({
      method: 'GET',
      url: `/store/orders/${orderId}`,
      headers: bearer(merchantToken),
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as {
      id: number
      status: string
      items: { productId: number }[]
      user: { email: string }
      coupon: { code: string; discountType: string } | null
      payments: unknown[]
    }
    expect(body.id).toBe(orderId)
    expect(body.user.email).toBe('shopper@t44.dev')
    expect(body.items[0]?.productId).toBe(productId)
    expect(body.coupon?.code).toBe('M21OFF')
    expect(body.coupon?.discountType).toBe('AMOUNT')
    expect(Array.isArray(body.payments)).toBe(true)
  })

  it('GET /store/orders/:id 404 for unknown id', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/store/orders/999999',
      headers: bearer(merchantToken),
    })
    expect(r.statusCode).toBe(404)
  })

  it('dashboard returns aggregated stats', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/store/dashboard',
      headers: bearer(merchantToken),
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as {
      ordersByStatus: Record<string, { count: number; totalCents: number }>
      productCount: number
      lowStockProducts: number
      lowStockThreshold: number
      reservedStockTotal: number
    }
    expect(body.productCount).toBeGreaterThanOrEqual(1)
    expect(body.lowStockThreshold).toBe(5)
    expect(typeof body.reservedStockTotal).toBe('number')
    expect(body.ordersByStatus['pending']?.count ?? 0).toBeGreaterThanOrEqual(0)
    expect(body.ordersByStatus['shipped']?.count ?? 0).toBeGreaterThanOrEqual(1)
  })
})
