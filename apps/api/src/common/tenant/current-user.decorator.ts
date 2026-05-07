import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import { getCurrentRequestContext, type RequestContext } from './tenant-context.js'

export const CurrentUser = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): RequestContext => {
    return getCurrentRequestContext()
  },
)
