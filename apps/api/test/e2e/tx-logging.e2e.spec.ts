import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { TenantId } from '@mall/shared'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'
import { PrismaService } from '../../src/common/prisma/prisma.service.js'
import { requestContextStorage } from '../../src/common/tenant/index.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Tx logging carries traceId + tenantId (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let prisma: PrismaService
  let token: string

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'debug'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '900'
    process.env['JWT_REFRESH_TTL_SECONDS'] = '604800'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [77])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    prisma = app.get(PrismaService)

    token = await registerAndLogin(app, {
      tenantId: 77,
      email: 'log@t77.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    delete process.env['AUTH_RATE_LIMIT_MAX']
  })

  it('withTenant inside an active RequestContext logs traceId + tenantId', async () => {
    const debugSpy = vi.spyOn(prisma['logger'], 'debug')
    await requestContextStorage.run(
      {
        tenantId: 77 as TenantId,
        userId: 1,
        email: 'log@t77.dev',
        role: 'admin',
        traceId: 'trace-xyz-123',
      },
      async () => {
        await prisma.withTenant(77 as TenantId, (tx) => tx.product.findMany())
      },
    )
    const calls = debugSpy.mock.calls.map((c) => c[0])
    expect(
      calls.some(
        (c) =>
          typeof c === 'object' &&
          c !== null &&
          (c as Record<string, unknown>)['phase'] === 'tx-commit' &&
          (c as Record<string, unknown>)['traceId'] === 'trace-xyz-123' &&
          (c as Record<string, unknown>)['tenantId'] === 77,
      ),
    ).toBe(true)
  })

  it('HTTP request triggers tx logs with the same traceId as fastify req.id', async () => {
    const debugSpy = vi.spyOn(prisma['logger'], 'debug')
    debugSpy.mockClear()
    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: bearer(token),
    })
    expect(res.statusCode).toBe(200)
    const traceId = res.headers['x-request-id'] ?? res.headers['request-id']

    // 至少有一条 tx-commit log 含 tenantId=77 + traceId（fastify 默认 reqId 即便客户端没传也会自动生成）
    const calls = debugSpy.mock.calls.map((c) => c[0])
    const txCommit = calls.find(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>)['phase'] === 'tx-commit' &&
        (c as Record<string, unknown>)['tenantId'] === 77,
    ) as Record<string, unknown> | undefined
    expect(txCommit, 'expected at least one tx-commit log for tenant 77').toBeDefined()
    expect(typeof txCommit!['traceId']).toBe('string')
    if (typeof traceId === 'string') {
      expect(txCommit!['traceId']).toBe(traceId)
    }
  })
})
