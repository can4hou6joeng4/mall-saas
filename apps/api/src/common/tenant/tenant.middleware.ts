import type { IncomingMessage, ServerResponse } from 'node:http'
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { isValidTenantId, type TenantId } from '@mall/shared'
import { tenantStorage } from './tenant-context.js'

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: (err?: unknown) => void): void {
    const raw = req.headers['x-tenant-id']
    const headerValue = Array.isArray(raw) ? raw[0] : raw
    const parsed = headerValue === undefined ? Number.NaN : Number(headerValue)
    if (!isValidTenantId(parsed)) {
      throw new UnauthorizedException('missing or invalid x-tenant-id')
    }
    const tenantId = parsed as TenantId
    tenantStorage.run({ tenantId }, () => next())
  }
}
