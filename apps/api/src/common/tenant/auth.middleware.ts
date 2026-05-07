import type { IncomingMessage, ServerResponse } from 'node:http'
import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { isValidTenantId, type TenantId } from '@mall/shared'
import { requestContextStorage } from './tenant-context.js'

interface JwtPayload {
  sub: number
  tenantId: number
  email: string
  role: string
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: IncomingMessage, _res: ServerResponse, next: (err?: unknown) => void): void {
    const auth = req.headers['authorization']
    const header = Array.isArray(auth) ? auth[0] : auth
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token')
    }
    const token = header.slice('Bearer '.length).trim()

    let payload: JwtPayload
    try {
      payload = this.jwt.verify<JwtPayload>(token)
    } catch {
      throw new UnauthorizedException('invalid or expired token')
    }
    if (!isValidTenantId(payload.tenantId)) {
      throw new UnauthorizedException('invalid tenant in token')
    }

    requestContextStorage.run(
      {
        tenantId: payload.tenantId as TenantId,
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      },
      () => next(),
    )
  }
}
