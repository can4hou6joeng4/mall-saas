import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Redis } from 'ioredis'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'
const REDIS_URL = 'redis://localhost:6379/0'

describe('Refresh token & password reset (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let redis: Redis

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = REDIS_URL
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '900'
    process.env['JWT_REFRESH_TTL_SECONDS'] = '604800'
    process.env['PASSWORD_RESET_TTL_SECONDS'] = '600'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['AUTH_RATE_LIMIT_MAX'] = '999' // 暂时放宽，rate-limit 由别的 spec 验证

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await owner.payment.deleteMany({})
    await owner.orderItem.deleteMany({})
    await owner.order.deleteMany({})
    await owner.user.deleteMany({})
    await owner.tenant.upsert({ where: { id: 33 }, update: {}, create: { id: 33, name: 't33' } })
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    redis.disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
  })

  beforeEach(async () => {
    // 清掉之前测试的 rate-limit 计数与 refresh/reset 白名单
    const keys = await redis.keys('ratelimit:auth:*')
    if (keys.length) await redis.del(...keys)
  })

  async function register(): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 33, email: `u-${Date.now()}-${Math.random()}@t33.dev`, password: 'p@ssw0rd!' },
    })
    expect(res.statusCode).toBe(201)
    return res.json() as { accessToken: string; refreshToken: string }
  }

  it('register returns both access and refresh tokens', async () => {
    const tokens = await register()
    expect(tokens.accessToken).toBeTruthy()
    expect(tokens.refreshToken).toBeTruthy()
    expect(tokens.accessToken).not.toBe(tokens.refreshToken)
  })

  it('access token works on tenant routes; refresh token does NOT', async () => {
    const tokens = await register()
    const ok = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(ok.statusCode).toBe(200)

    const bad = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${tokens.refreshToken}` },
    })
    expect(bad.statusCode).toBe(401)
  })

  it('POST /auth/refresh rotates tokens and invalidates the old refresh', async () => {
    const tokens = await register()
    const r1 = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    })
    expect(r1.statusCode).toBe(200)
    const newTokens = r1.json() as { accessToken: string; refreshToken: string }
    expect(newTokens.refreshToken).not.toBe(tokens.refreshToken)

    // 老 refresh 已被撤销
    const r2 = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    })
    expect(r2.statusCode).toBe(401)
  })

  it('POST /auth/logout revokes the refresh token', async () => {
    const tokens = await register()
    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: tokens.refreshToken },
    })
    expect(out.statusCode).toBe(204)
    const r = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    })
    expect(r.statusCode).toBe(401)
  })

  it('password reset flow: request → confirm → login with new password', async () => {
    const email = `reset-${Date.now()}@t33.dev`
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantId: 33, email, password: 'oldpass!1' },
    })
    expect(reg.statusCode).toBe(201)

    const req = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { tenantId: 33, email },
    })
    expect(req.statusCode).toBe(200)
    const { resetToken } = req.json() as { resetToken: string }

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { resetToken, newPassword: 'newpass!1' },
    })
    expect(confirm.statusCode).toBe(200)

    // 旧密码应失败
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 33, email, password: 'oldpass!1' },
    })
    expect(oldLogin.statusCode).toBe(401)

    // 新密码应成功
    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 33, email, password: 'newpass!1' },
    })
    expect(newLogin.statusCode).toBe(200)

    // reset token 不可重放
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { resetToken, newPassword: 'replay!1' },
    })
    expect(replay.statusCode).toBe(401)
  })
})
