import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { getCurrentTenantContext } from './tenant-context.js'

export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): TenantId => {
    return getCurrentTenantContext().tenantId
  },
)
