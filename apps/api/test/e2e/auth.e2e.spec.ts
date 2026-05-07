import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { JwtService } from '@nestjs/jwt'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Auth API (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let jwt: JwtService

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
    await owner.payment.deleteMany({})
    await owner.orderItem.deleteMany({})
    await owner.order.deleteMany({})
    await owner.user.deleteMany({})
    await owner.tenant.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: 't1' } })
    await owner.tenant.upsert({ where: { id: 2 }, update: {}, create: { id: 2, name: 't2' } })

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    jwt = app.get(JwtService)
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('registers a new user under tenant 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 1, email: 'alice@t1.dev', password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { accessToken: string; user: { id: number; tenantId: number; role: string } }
    expect(body.accessToken).toBeTruthy()
    expect(body.user.tenantId).toBe(1)
    expect(body.user.role).toBe('user')
    const decoded = jwt.verify<{ sub: number; tenantId: number; role: string }>(body.accessToken)
    expect(decoded.sub).toBe(body.user.id)
    expect(decoded.tenantId).toBe(1)
    expect(decoded.role).toBe('user')
  })

  it('rejects duplicate email under same tenant with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 1, email: 'alice@t1.dev', password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('allows same email under different tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 2, email: 'alice@t1.dev', password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('rejects register with weak password (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 1, email: 'bob@t1.dev', password: '123' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects register with unknown tenant (404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 9999, email: 'ghost@t.dev', password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('logs in with correct credentials and returns a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 1, email: 'alice@t1.dev', password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { accessToken: string; user: { id: number } }
    expect(body.accessToken).toBeTruthy()
  })

  it('rejects login with wrong password (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 1, email: 'alice@t1.dev', password: 'wrong-pw' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects login with cross-tenant email (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 2, email: 'unknown@t2.dev', password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(401)
  })
})
