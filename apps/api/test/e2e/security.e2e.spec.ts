import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { registerFastifyPlugins } from '../../src/bootstrap/fastify-plugins.js'

describe('Security plugins (e2e)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
    process.env['DATABASE_APP_URL'] = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '3600'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['RATE_LIMIT_MAX'] = '3'
    process.env['RATE_LIMIT_WINDOW'] = '5 seconds'

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await registerFastifyPlugins(app)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['RATE_LIMIT_MAX']
    delete process.env['RATE_LIMIT_WINDOW']
  })

  it('healthz response carries helmet security headers', async () => {
    // RATE_LIMIT_MAX=3 — single request safe
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
    expect(res.headers['strict-transport-security']).toBeDefined()
  })

  it('rate-limit returns 429 once max is exceeded', async () => {
    // healthz 已经消耗 1 次配额；剩 2 次。再发 4 次中至少最后一次 429
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({ method: 'GET', url: '/healthz' })
      codes.push(r.statusCode)
    }
    expect(codes).toContain(429)
  })
})
