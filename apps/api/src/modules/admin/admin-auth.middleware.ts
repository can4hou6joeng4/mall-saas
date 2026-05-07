import type { IncomingMessage, ServerResponse } from 'node:http'
import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { platformAdminStorage } from './admin-context.js'
import type { PlatformJwtPayload } from './admin-auth.service.js'

@Injectable()
export class AdminAuthMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: IncomingMessage, _res: ServerResponse, next: (err?: unknown) => void): void {
    const auth = req.headers['authorization']
    const header = Array.isArray(auth) ? auth[0] : auth
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing platform bearer token')
    }
    const token = header.slice('Bearer '.length).trim()

    let payload: PlatformJwtPayload
    try {
      payload = this.jwt.verify<PlatformJwtPayload>(token)
    } catch {
      throw new UnauthorizedException('invalid or expired platform token')
    }
    if (payload.scope !== 'platform') {
      throw new UnauthorizedException('this endpoint requires a platform token')
    }
    platformAdminStorage.run(
      { adminId: payload.sub, email: payload.email },
      () => next(),
    )
  }
}
