import { randomUUID } from 'node:crypto'
import { Module } from '@nestjs/common'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: true,
        genReqId: (req) => {
          const headerId = (req.headers['x-request-id'] as string | undefined) ?? ''
          return headerId || randomUUID()
        },
        customProps: (req) => ({
          tenantId: req.headers['x-tenant-id'] ?? null,
        }),
      },
    }),
  ],
})
export class LoggerModule {}
