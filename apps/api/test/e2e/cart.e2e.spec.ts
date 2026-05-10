import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Cart API + checkout (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let adminToken: string
  let userToken: string
  let phoneId = 0
  let bookId = 0

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
    await owner.cartItem.deleteMany({})
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [88])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    adminToken = await registerAndLogin(app, {
      tenantId: 88,
      email: 'admin@t88.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 88,
      email: 'user@t88.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const phone = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Phone', priceCents: 5000, stock: 5 },
    })
    phoneId = (phone.json() as { id: number }).id
    const book = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Book', priceCents: 1000, stock: 10 },
    })
    bookId = (book.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
  })

  it('starts with an empty cart', async () => {
    const res = await app.inject({ method: 'GET', url: '/cart', headers: bearer(userToken) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('adds a product to cart and lists it', async () => {
    const add = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: bearer(userToken),
      payload: { productId: phoneId, quantity: 2 },
    })
    expect(add.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/cart', headers: bearer(userToken) })
    const items = list.json() as { productId: number; quantity: number }[]
    expect(items).toHaveLength(1)
    expect(items[0]?.productId).toBe(phoneId)
    expect(items[0]?.quantity).toBe(2)
  })

  it('adding the same product accumulates quantity', async () => {
    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: bearer(userToken),
      payload: { productId: phoneId, quantity: 1 },
    })
    const list = await app.inject({ method: 'GET', url: '/cart', headers: bearer(userToken) })
    const items = list.json() as { productId: number; quantity: number }[]
    const phone = items.find((i) => i.productId === phoneId)
    expect(phone?.quantity).toBe(3)
  })

  it('PATCH overrides quantity; DELETE removes one item', async () => {
    const add2 = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: bearer(userToken),
      payload: { productId: bookId, quantity: 5 },
    })
    expect(add2.statusCode).toBe(200)
    const patched = await app.inject({
      method: 'PATCH',
      url: `/cart/items/${bookId}`,
      headers: bearer(userToken),
      payload: { quantity: 7 },
    })
    expect(patched.statusCode).toBe(200)
    expect((patched.json() as { quantity: number }).quantity).toBe(7)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/cart/items/${bookId}`,
      headers: bearer(userToken),
    })
    expect(removed.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/cart', headers: bearer(userToken) })
    const items = list.json() as { productId: number }[]
    expect(items.find((i) => i.productId === bookId)).toBeUndefined()
  })

  it('checkout converts cart into a pending order with reserved stock and clears the cart', async () => {
    // 当前 cart 应仍有 phone qty=3
    const beforeStock = (await owner.product.findUnique({ where: { id: phoneId } }))!
    expect(beforeStock.reservedStock).toBe(0)

    const out = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: bearer(userToken),
    })
    expect(out.statusCode).toBe(201)
    const order = out.json() as { id: number; status: string; items: { quantity: number }[] }
    expect(order.status).toBe('pending')
    expect(order.items[0]?.quantity).toBe(3)

    const after = (await owner.product.findUnique({ where: { id: phoneId } }))!
    expect(after.stock).toBe(beforeStock.stock)
    expect(after.reservedStock).toBe(3)

    const list = await app.inject({ method: 'GET', url: '/cart', headers: bearer(userToken) })
    expect(list.json()).toEqual([])
  })

  it('checkout on empty cart returns 404', async () => {
    const out = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: bearer(userToken),
    })
    expect(out.statusCode).toBe(404)
  })

  it('checkout with couponCode applies discount; invalid code is rejected; bare body still works', async () => {
    // 准备：admin 创建优惠券 + user 加购
    const merchantToken = await registerAndLogin(app, {
      tenantId: 88,
      email: 'merchant@t88.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    // code 加随机后缀避免跨 run unique 冲突
    const code = `BOOK_OFF_${Date.now()}`
    const cou = await app.inject({
      method: 'POST',
      url: '/coupons',
      headers: bearer(merchantToken),
      payload: {
        code,
        discountType: 'AMOUNT',
        discountValue: 500,
        minOrderCents: 0,
        maxUsage: 0,
      },
    })
    expect(cou.statusCode).toBe(201)

    // 1) 不带 body：仍然 201（向后兼容 M19 storefront）
    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: bearer(userToken),
      payload: { productId: bookId, quantity: 1 },
    })
    const bare = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: bearer(userToken),
    })
    expect(bare.statusCode).toBe(201)
    const bareOrder = bare.json() as { discountCents: number; couponId: number | null }
    expect(bareOrder.discountCents).toBe(0)
    expect(bareOrder.couponId).toBeNull()

    // 2) 带有效 couponCode：discount > 0
    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: bearer(userToken),
      payload: { productId: bookId, quantity: 2 },
    })
    const withCoupon = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: bearer(userToken),
      payload: { couponCode: code },
    })
    expect(withCoupon.statusCode).toBe(201)
    const couponOrder = withCoupon.json() as { discountCents: number; couponId: number | null }
    expect(couponOrder.discountCents).toBe(500)
    expect(couponOrder.couponId).not.toBeNull()

    // 3) 不存在的券 → 404 + cart 不被清空
    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: bearer(userToken),
      payload: { productId: bookId, quantity: 1 },
    })
    const bad = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: bearer(userToken),
      payload: { couponCode: 'NOPE' },
    })
    expect(bad.statusCode).toBe(404)
    const cart = await app.inject({ method: 'GET', url: '/cart', headers: bearer(userToken) })
    expect((cart.json() as unknown[]).length).toBe(1)
  })
})
