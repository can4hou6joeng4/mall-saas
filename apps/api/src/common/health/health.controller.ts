import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService } from '../redis/redis.service.js'

interface ReadinessBody {
  status: 'ok' | 'fail'
  checks: { db: 'ok' | 'fail'; redis: 'ok' | 'fail' }
}

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('/healthz')
  liveness(): { status: 'ok' } {
    return { status: 'ok' }
  }

  @Get('/readyz')
  async readiness(): Promise<ReadinessBody> {
    const [db, redis] = await Promise.all([this.checkDb(), this.redis.ping()])
    const ok = db && redis
    return {
      status: ok ? 'ok' : 'fail',
      checks: { db: db ? 'ok' : 'fail', redis: redis ? 'ok' : 'fail' },
    }
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
