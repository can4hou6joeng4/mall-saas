import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Redis } from 'ioredis'

const REDIS_URL = 'redis://localhost:6379/0'

describe('Auth endpoints rate limit (e2e)', () => {
  let app: NestFastifyApplication
  let redis: Redis

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
    process.env['DATABASE_APP_URL'] = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'
    process.env['REDIS_URL'] = REDIS_URL
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '900'
    process.env['JWT_REFRESH_TTL_SECONDS'] = '604800'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['AUTH_RATE_LIMIT_MAX'] = '3'
    process.env['AUTH_RATE_LIMIT_WINDOW_SEC'] = '60'

    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
    const keys = await redis.keys('ratelimit:auth:*')
    if (keys.length) await redis.del(...keys)

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
    redis.disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
    delete process.env['AUTH_RATE_LIMIT_WINDOW_SEC']
  })

  it('login endpoint rejects with 429 after exceeding AUTH_RATE_LIMIT_MAX', async () => {
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { tenantId: 999, email: 'nope@nope.dev', password: 'wrongpw' },
      })
      codes.push(r.statusCode)
    }
    // 前 3 次正常返回 401（凭据错），后续命中 429
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  })
})
