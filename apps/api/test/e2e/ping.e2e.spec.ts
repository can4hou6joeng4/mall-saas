import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'

describe('GET /ping (e2e)', () => {
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

  it('echoes the tenantId provided via header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-tenant-id': '7' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, tenantId: 7 })
  })

  it('returns 401 when x-tenant-id is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when x-tenant-id is invalid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-tenant-id': 'not-a-number' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('healthz remains accessible without x-tenant-id', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
