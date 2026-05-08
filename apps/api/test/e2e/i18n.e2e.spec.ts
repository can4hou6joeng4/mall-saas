import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('i18n error messages (e2e)', () => {
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
    process.env['JWT_TTL_SECONDS'] = '900'
    process.env['JWT_REFRESH_TTL_SECONDS'] = '604800'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [99])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    token = await registerAndLogin(app, {
      tenantId: 99,
      email: 'i18n@t99.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
  })

  it('returns English message when Accept-Language=en', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/products/999999',
      headers: { ...bearer(token), 'accept-language': 'en' },
    })
    expect(r.statusCode).toBe(404)
    const body = r.json() as { message: string; code: string }
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toBe('Product 999999 not found')
  })

  it('returns Chinese message when Accept-Language=zh-CN', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/products/999999',
      headers: { ...bearer(token), 'accept-language': 'zh-CN,zh;q=0.9' },
    })
    expect(r.statusCode).toBe(404)
    const body = r.json() as { message: string; code: string }
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toBe('商品 999999 不存在')
  })

  it('falls back to English when language header is absent', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/products/999999',
      headers: bearer(token),
    })
    expect(r.statusCode).toBe(404)
    expect((r.json() as { message: string }).message).toBe('Product 999999 not found')
  })
})
