import { Controller, Get, Headers } from '@nestjs/common'
import { isValidTenantId } from '@mall/shared'

@Controller('ping')
export class PingController {
  @Get()
  ping(@Headers('x-tenant-id') tenantHeader?: string): { ok: true; tenantId: number } {
    const tenantId = Number(tenantHeader)
    if (!isValidTenantId(tenantId)) {
      return { ok: true, tenantId: 0 }
    }
    return { ok: true, tenantId }
  }
}
