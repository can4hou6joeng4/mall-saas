import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { MetricsService } from '../common/metrics/metrics.service.js'

type Registerable = (
  plugin: unknown,
  opts?: Record<string, unknown>,
) => Promise<unknown>

const START_KEY = '__metricsStartedAt'

interface FastifyReqWithStart {
  [START_KEY]?: bigint
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
  const uploadsDir = resolve(process.env['STORAGE_LOCAL_DIR'] ?? './var/uploads')
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
  })
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
