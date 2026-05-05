import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from '../../src/app.module.js'

describe('GET /ping (e2e)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns { ok: true } and a tenantId echo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-tenant-id': '7' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, tenantId: 7 })
  })
})
