import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'

const TRACEID32 = /^[0-9a-f]{32}$/
const SPANID16 = /^[0-9a-f]{16}$/
const TRACERESPONSE_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

describe('W3C Trace Context (e2e)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
    process.env['DATABASE_APP_URL'] = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '3600'
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'

    const { AppModule } = await import('../../src/app.module.js')
    const { genReqIdWithTrace } = await import('../../src/common/trace/trace-context.js')
    const { registerFastifyPlugins } = await import('../../src/bootstrap/fastify-plugins.js')

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    // 复用 prod FastifyAdapter 配置：genReqIdWithTrace + registerFastifyPlugins(onSend traceresponse)
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ genReqId: genReqIdWithTrace }),
    )
    // 必须在 app.init() 之前注册 fastify 插件，否则 onSend 等 hook 不会挂上
    await registerFastifyPlugins(app)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('without traceparent: generates new traceId / spanId and writes traceresponse', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    const tr = res.headers['traceresponse']
    expect(typeof tr).toBe('string')
    const m = TRACERESPONSE_RE.exec(tr as string)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(TRACEID32)
    expect(m![2]).toMatch(SPANID16)
  })

  it('with valid traceparent: reuses inbound traceId, fresh spanId', async () => {
    const inboundTrace = '4bf92f3577b34da6a3ce929d0e0e4736'
    const inboundSpan = '00f067aa0ba902b7'
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { traceparent: `00-${inboundTrace}-${inboundSpan}-01` },
    })
    expect(res.statusCode).toBe(200)
    const m = TRACERESPONSE_RE.exec(res.headers['traceresponse'] as string)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(inboundTrace)
    // 新 spanId 不能等于上游 spanId
    expect(m![2]).toMatch(SPANID16)
    expect(m![2]).not.toBe(inboundSpan)
  })

  it('with malformed traceparent: falls back to fresh traceId (does not 4xx)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { traceparent: 'definitely-not-w3c' },
    })
    expect(res.statusCode).toBe(200)
    const m = TRACERESPONSE_RE.exec(res.headers['traceresponse'] as string)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(TRACEID32)
  })

  it('with all-zero traceId: rejected as invalid, generates new', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { traceparent: `00-${'0'.repeat(32)}-${'0'.repeat(16)}-01` },
    })
    expect(res.statusCode).toBe(200)
    const m = TRACERESPONSE_RE.exec(res.headers['traceresponse'] as string)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(TRACEID32)
    expect(m![1]).not.toBe('0'.repeat(32))
  })

  it('error response.requestId equals the traceId (single-id semantics)', async () => {
    const inboundTrace = '0123456789abcdef0123456789abcdef'
    const res = await app.inject({
      method: 'GET',
      url: '/orders/999999',
      headers: { traceparent: `00-${inboundTrace}-${'aa'.repeat(8)}-01` },
    })
    expect(res.statusCode).toBe(401)
    const body = res.json() as { requestId: string }
    expect(body.requestId).toBe(inboundTrace)
  })
})
