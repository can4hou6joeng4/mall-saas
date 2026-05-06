import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/healthz')
  liveness(): { status: 'ok' } {
    return { status: 'ok' }
  }

  @Get('/readyz')
  async readiness(): Promise<{ status: 'ok' | 'fail'; checks: { db: 'ok' | 'fail' } }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ok', checks: { db: 'ok' } }
    } catch {
      return { status: 'fail', checks: { db: 'fail' } }
    }
  }
}
