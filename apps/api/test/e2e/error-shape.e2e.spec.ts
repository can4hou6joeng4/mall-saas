import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'

describe('Global error response shape (e2e)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
    process.env['DATABASE_APP_URL'] = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns UNAUTHORIZED shape for missing tenant', async () => {
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
      headers: { 'x-tenant-id': '1' },
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
      headers: { 'x-tenant-id': '1' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
    expect(body['message']).toMatch(/not found/)
    expect(typeof body['requestId']).toBe('string')
  })
})
