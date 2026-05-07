import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Global error response shape (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let token: string

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
    await ensureTenants(owner, [1])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    token = await registerAndLogin(app, {
      tenantId: 1,
      email: 'errors@t1.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('returns UNAUTHORIZED shape when Authorization is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(401)
    const body = res.json() as Record<string, unknown>
    expect(body['code']).toBe('UNAUTHORIZED')
    expect(typeof body['message']).toBe('string')
    expect(typeof body['requestId']).toBe('string')
    expect((body['requestId'] as string).length).toBeGreaterThan(0)
  })

  it('returns BAD_REQUEST shape for invalid payload with details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(token),
      payload: { name: '', priceCents: -1 },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as Record<string, unknown>
    expect(body['code']).toBe('BAD_REQUEST')
    expect(typeof body['message']).toBe('string')
    expect(typeof body['requestId']).toBe('string')
    expect(body['details']).toBeDefined()
  })

  it('returns NOT_FOUND shape for missing product', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products/999999',
      headers: bearer(token),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
    expect(body['message']).toMatch(/not found/)
    expect(typeof body['requestId']).toBe('string')
  })
})
