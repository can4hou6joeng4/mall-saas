import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'
const ADMIN_EMAIL = 'platform-admin@example.com'
const ADMIN_PASSWORD = 'admin-pw-1234'

describe('Admin BFF (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let platformToken: string
  let tenantUserToken: string

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
    process.env['PLATFORM_ADMIN_EMAIL'] = ADMIN_EMAIL
    process.env['PLATFORM_ADMIN_PASSWORD'] = ADMIN_PASSWORD

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await owner.platformAdmin.deleteMany({})
    await owner.payment.deleteMany({})
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    // 不预建 tenant —— 验证平台 admin 自己创建
    await owner.tenant.deleteMany({ where: { id: { in: [201, 202] } } })
    // 其他 spec 通过 upsert 直接塞入显式 id，未推进 SERIAL 序列；这里把序列推到 max(id)+1 防主键冲突
    await owner.$executeRawUnsafe(
      `SELECT setval('"Tenant_id_seq"', GREATEST((SELECT COALESCE(MAX(id), 0) FROM "Tenant"), 1))`,
    )

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('bootstrap created the initial platform admin from env', async () => {
    const found = await owner.platformAdmin.findUnique({ where: { email: ADMIN_EMAIL } })
    expect(found).not.toBeNull()
  })

  it('platform admin can login and obtain a platform token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { accessToken: string; admin: { email: string } }
    expect(body.admin.email).toBe(ADMIN_EMAIL)
    platformToken = body.accessToken
  })

  it('rejects login with wrong password (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: ADMIN_EMAIL, password: 'nope' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('admin endpoints reject missing/invalid platform token (401)', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/admin/tenants' })
    expect(r1.statusCode).toBe(401)
    const r2 = await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(r2.statusCode).toBe(401)
  })

  it('platform admin creates two tenants', async () => {
    for (const name of ['Acme Inc', 'Globex']) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: bearer(platformToken),
        payload: { name },
      })
      expect(res.statusCode).toBe(201)
    }
    const list = await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: bearer(platformToken),
    })
    expect(list.statusCode).toBe(200)
    const items = list.json() as { id: number; name: string }[]
    expect(items.length).toBeGreaterThanOrEqual(2)
  })

  it('admin can rename a tenant', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: bearer(platformToken),
      payload: { name: 'Initech' },
    })
    const id = (created.json() as { id: number }).id
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/admin/tenants/${id}`,
      headers: bearer(platformToken),
      payload: { name: 'Initech Renamed' },
    })
    expect(renamed.statusCode).toBe(200)
    expect((renamed.json() as { name: string }).name).toBe('Initech Renamed')
  })

  it('rejects deleting a tenant that still has data (409)', async () => {
    // 先建一个并塞个 user
    await ensureTenants(owner, [201])
    tenantUserToken = await registerAndLogin(app, {
      tenantId: 201,
      email: 'shop@t201.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/tenants/201',
      headers: bearer(platformToken),
    })
    expect(res.statusCode).toBe(409)
  })

  it('cross-tenant order/payment listing requires platform token', async () => {
    // 用 tenant token 调 admin 端点应 401
    const res = await app.inject({
      method: 'GET',
      url: '/admin/orders',
      headers: bearer(tenantUserToken),
    })
    expect(res.statusCode).toBe(401)
  })

  it('platform admin can view orders/payments across tenants (read-only)', async () => {
    const orders = await app.inject({
      method: 'GET',
      url: '/admin/orders?page=1&pageSize=10',
      headers: bearer(platformToken),
    })
    expect(orders.statusCode).toBe(200)
    const oBody = orders.json() as { items: unknown[]; total: number }
    expect(typeof oBody.total).toBe('number')

    const payments = await app.inject({
      method: 'GET',
      url: '/admin/payments?page=1&pageSize=10',
      headers: bearer(platformToken),
    })
    expect(payments.statusCode).toBe(200)
  })

  it('platform token cannot be used for tenant routes (scope mismatch 401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: bearer(platformToken),
    })
    expect(res.statusCode).toBe(401)
  })
})
