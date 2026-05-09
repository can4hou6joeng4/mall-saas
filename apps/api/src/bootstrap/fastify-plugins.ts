import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { MetricsService } from '../common/metrics/metrics.service.js'
import { attachSpanContext, formatTraceresponse } from '../common/trace/trace-context.js'

type Registerable = (
  plugin: unknown,
  opts?: Record<string, unknown>,
) => Promise<unknown>

const START_KEY = '__metricsStartedAt'

interface FastifyReqWithStart {
  [START_KEY]?: bigint
  id?: string
  spanId?: string
  method?: string
  url?: string
  routeOptions?: { url?: string }
}

export async function registerFastifyPlugins(app: NestFastifyApplication): Promise<void> {
  const register = app.register.bind(app) as unknown as Registerable

  await register(helmet, { contentSecurityPolicy: false })

  const max = Number(process.env['RATE_LIMIT_MAX'] ?? 200)
  const timeWindow = process.env['RATE_LIMIT_WINDOW'] ?? '1 minute'
  await register(rateLimit, { max, timeWindow })

  // 文件上传
  await register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  })

  // 静态投放：本地存储模式下把 uploads 暴露到 /uploads（生产改为 CDN/对象存储）
  // 默认走 /tmp 避免镜像内 /app 非 root 用户无写权限
  const uploadsDir = resolve(process.env['STORAGE_LOCAL_DIR'] ?? '/tmp/mall-uploads')
  await mkdir(uploadsDir, { recursive: true })
  await register(fastifyStatic, {
    root: uploadsDir,
    prefix: process.env['STORAGE_PUBLIC_BASE'] ?? '/uploads/',
    decorateReply: false,
  })

  const metrics = app.get(MetricsService)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fastify = app.getHttpAdapter().getInstance() as any
  fastify.addHook('onRequest', async (req: FastifyReqWithStart) => {
    req[START_KEY] = process.hrtime.bigint()
    // 在 FastifyRequest 上挂 spanId / parentSpanId（genReqId 阶段挂到 raw req 上跨不到这里）
    attachSpanContext(req)
  })
  // W3C Trace Context：把 traceId(=req.id) + spanId 写回 traceresponse，方便客户端 / 网关溯源
  fastify.addHook(
    'onSend',
    async (
      req: FastifyReqWithStart,
      reply: { header: (k: string, v: string) => void },
      payload: unknown,
    ) => {
      if (typeof req.id === 'string' && typeof req.spanId === 'string') {
        reply.header('traceresponse', formatTraceresponse(req.id, req.spanId))
      }
      return payload
    },
  )
  fastify.addHook(
    'onResponse',
    async (
      req: FastifyReqWithStart,
      reply: { statusCode: number },
    ) => {
      const start = req[START_KEY]
      if (start === undefined) return
      const seconds = Number(process.hrtime.bigint() - start) / 1e9
      const route = req.routeOptions?.url ?? req.url ?? 'unknown'
      metrics.observe(req.method ?? 'GET', route, reply.statusCode, seconds)
    },
  )
}
