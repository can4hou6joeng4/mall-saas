import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('GET /ping (e2e, JWT-protected)', () => {
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
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await clearAuthData(owner)
    await ensureTenants(owner, [7])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    token = await registerAndLogin(app, {
      tenantId: 7,
      email: 'ping@t7.dev',
      password: 'p@ssw0rd!',
    })
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('echoes the tenantId derived from the JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: bearer(token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, tenantId: 7 })
  })

  it('returns 401 when Authorization is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when Bearer token is malformed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('healthz remains accessible without Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
