import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RedisService } from '../redis/redis.service.js'

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { ip?: string }>()
    const ip = req.ip ?? '0.0.0.0'
    const path = req.routeOptions?.url ?? req.url ?? 'unknown'
    const max = Number(process.env['AUTH_RATE_LIMIT_MAX'] ?? 5)
    const windowSec = Number(process.env['AUTH_RATE_LIMIT_WINDOW_SEC'] ?? 60)

    const key = `ratelimit:auth:${ip}:${path}`
    const count = await this.redis.incrWithTTL(key, windowSec)
    if (count > max) {
      throw new HttpException(
        'too many auth attempts, please retry later',
        429,
      )
    }
    return true
  }
}
