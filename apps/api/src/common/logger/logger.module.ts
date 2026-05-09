import { Module } from '@nestjs/common'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'

interface ReqWithTrace {
  id?: string
  spanId?: string
  parentSpanId?: string
  headers: Record<string, string | string[] | undefined>
}

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: true,
        // req.id / req.spanId 由 FastifyAdapter 的 genReqIdWithTrace 在请求创建时统一注入
        // 这里只把它们提升到每条 log line 的 top-level field，便于日志聚合时按 traceId/spanId 过滤
        customProps: (req) => {
          const r = req as unknown as ReqWithTrace
          return {
            tenantId: req.headers['x-tenant-id'] ?? null,
            traceId: r.id ?? null,
            spanId: r.spanId ?? null,
            parentSpanId: r.parentSpanId ?? null,
          }
        },
      },
    }),
  ],
})
export class LoggerModule {}
