import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// `app.register` 的 generic 参数与 Fastify 第三方插件类型偶有摩擦；用宽松的 register 句柄绕开 TS 噪音
type Registerable = (
  plugin: unknown,
  opts?: Record<string, unknown>,
) => Promise<unknown>

export async function registerFastifyPlugins(app: NestFastifyApplication): Promise<void> {
  const register = app.register.bind(app) as unknown as Registerable

  await register(helmet, {
    contentSecurityPolicy: false,
  })

  const max = Number(process.env['RATE_LIMIT_MAX'] ?? 200)
  const timeWindow = process.env['RATE_LIMIT_WINDOW'] ?? '1 minute'
  await register(rateLimit, { max, timeWindow })
}
