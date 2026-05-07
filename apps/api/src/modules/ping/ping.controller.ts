import { Controller, Get } from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { CurrentTenant } from '../../common/tenant/index.js'

@Controller('ping')
export class PingController {
  @Get()
  ping(@CurrentTenant() tenantId: TenantId): { ok: true; tenantId: TenantId } {
    return { ok: true, tenantId }
  }
}
