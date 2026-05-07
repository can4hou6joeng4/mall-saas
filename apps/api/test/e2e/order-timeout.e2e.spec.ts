import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Order timeout via BullMQ (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let userToken: string
  let adminToken: string
  let productId = 0

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '3600'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['ORDER_TIMEOUT_MS'] = '500'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [42])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    adminToken = await registerAndLogin(app, {
      tenantId: 42,
      email: 'admin@t42.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 42,
      email: 'user@t42.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'TimeoutItem', priceCents: 1000, stock: 5 },
    })
    productId = (created.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('pending order is auto-cancelled and stock rolled back after timeout', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId, quantity: 2 }] },
    })
    expect(create.statusCode).toBe(201)
    const orderId = (create.json() as { id: number }).id

    const stockAfterCreate = await owner.product.findUnique({ where: { id: productId } })
    expect(stockAfterCreate?.stock).toBe(3)

    // 等待 timeout job 处理（默认 500ms 延迟 + 处理时间）
    for (let i = 0; i < 30; i++) {
      const order = await owner.order.findUnique({ where: { id: orderId } })
      if (order?.status === 'cancelled') break
      await new Promise((r) => setTimeout(r, 200))
    }

    const finalOrder = await owner.order.findUnique({ where: { id: orderId } })
    expect(finalOrder?.status).toBe('cancelled')

    const stockAfterTimeout = await owner.product.findUnique({ where: { id: productId } })
    expect(stockAfterTimeout?.stock).toBe(5)
  })
})
