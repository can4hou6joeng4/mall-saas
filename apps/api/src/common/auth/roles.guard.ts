import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { getCurrentRequestContext } from '../tenant/tenant-context.js'
import { ROLES_KEY } from './roles.decorator.js'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!required || required.length === 0) return true
    const { role } = getCurrentRequestContext()
    if (!required.includes(role)) {
      throw new ForbiddenException(`role '${role}' is not allowed`)
    }
    return true
  }
}
