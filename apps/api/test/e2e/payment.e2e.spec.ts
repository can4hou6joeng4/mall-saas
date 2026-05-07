import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'
import { MockPaymentProvider } from '../../src/modules/payment/provider/mock-payment-provider.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Payments API (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let mock: MockPaymentProvider
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
    process.env['JWT_TTL_SECONDS'] = '3600'
    process.env['ORDER_TIMEOUT_MS'] = String(30 * 60 * 1000)
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-shared-secret'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await owner.payment.deleteMany({})
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [55])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    mock = app.get(MockPaymentProvider)

    adminToken = await registerAndLogin(app, {
      tenantId: 55,
      email: 'admin@t55.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 55,
      email: 'user@t55.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Phone', priceCents: 5000, stock: 10 },
    })
    productId = (created.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  async function placeOrder(quantity: number): Promise<{ orderId: number; total: number }> {
    const r = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(userToken),
      payload: { items: [{ productId, quantity }] },
    })
    expect(r.statusCode).toBe(201)
    const body = r.json() as { id: number; totalCents: number }
    return { orderId: body.id, total: body.totalCents }
  }

  async function pay(orderId: number): Promise<{ providerRef: string; paymentId: number }> {
    const r = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/pay`,
      headers: bearer(userToken),
      payload: { provider: 'mock' },
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { id: number; providerRef: string }
    return { providerRef: body.providerRef, paymentId: body.id }
  }

  async function postWebhook(
    body: Record<string, unknown>,
    sigOverride?: string,
  ): Promise<ReturnType<NestFastifyApplication['inject']>> {
    const raw = JSON.stringify(body)
    const sig = sigOverride ?? mock.signWebhookBody(raw)
    return app.inject({
      method: 'POST',
      url: '/webhooks/payments/mock',
      headers: { 'content-type': 'application/json', 'x-mock-signature': sig },
      payload: raw,
    })
  }

  it('happy path: pay → webhook → order goes to paid', async () => {
    const { orderId } = await placeOrder(1)
    const { providerRef } = await pay(orderId)

    const ack = await postWebhook({ providerRef, status: 'succeeded' })
    expect(ack.statusCode).toBe(200)
    expect((ack.json() as { acknowledged: boolean }).acknowledged).toBe(true)

    const order = await owner.order.findUnique({ where: { id: orderId } })
    expect(order?.status).toBe('paid')
  })

  it('webhook with bad signature is rejected (401)', async () => {
    const { orderId } = await placeOrder(1)
    const { providerRef } = await pay(orderId)
    const r = await postWebhook(
      { providerRef, status: 'succeeded' },
      'deadbeef'.repeat(8),
    )
    expect(r.statusCode).toBe(401)
  })

  it('cannot pay an already-paid order (409)', async () => {
    const { orderId } = await placeOrder(1)
    const { providerRef } = await pay(orderId)
    await postWebhook({ providerRef, status: 'succeeded' })

    const r = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/pay`,
      headers: bearer(userToken),
      payload: { provider: 'mock' },
    })
    expect(r.statusCode).toBe(409)
  })

  it('webhook is idempotent on replay', async () => {
    const { orderId } = await placeOrder(1)
    const { providerRef } = await pay(orderId)
    const r1 = await postWebhook({ providerRef, status: 'succeeded' })
    const r2 = await postWebhook({ providerRef, status: 'succeeded' })
    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    const order = await owner.order.findUnique({ where: { id: orderId } })
    expect(order?.status).toBe('paid')
  })

  it('failed webhook cancels the order and rolls stock back', async () => {
    const stockBefore = (await owner.product.findUnique({ where: { id: productId } }))!.stock
    const { orderId } = await placeOrder(2)
    const { providerRef } = await pay(orderId)
    const stockMid = (await owner.product.findUnique({ where: { id: productId } }))!.stock
    expect(stockMid).toBe(stockBefore - 2)

    const r = await postWebhook({ providerRef, status: 'failed' })
    expect(r.statusCode).toBe(200)

    const order = await owner.order.findUnique({ where: { id: orderId } })
    expect(order?.status).toBe('cancelled')
    const stockAfter = (await owner.product.findUnique({ where: { id: productId } }))!.stock
    expect(stockAfter).toBe(stockBefore)
  })
})
