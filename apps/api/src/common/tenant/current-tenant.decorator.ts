import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { getCurrentRequestContext } from './tenant-context.js'

export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): TenantId => {
    return getCurrentRequestContext().tenantId
  },
)
