import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import { hashPassword, verifyPassword } from '../../common/auth/password.js'
import type { LoginDto, RegisterDto } from './auth.dto.js'

export interface JwtPayload {
  sub: number
  tenantId: number
  email: string
  role: string
  scope: 'tenant'
}

export interface AuthResult {
  accessToken: string
  user: { id: number; tenantId: number; email: string; role: string }
}

const JWT_TTL = 'JWT_TTL_SECONDS'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(JWT_TTL) private readonly ttlSeconds: number,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const tenantId = dto.tenantId as TenantId
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      throw new NotFoundException(`tenant ${tenantId} not found`)
    }

    const passwordHash = hashPassword(dto.password)
    const role = dto.role ?? 'user'

    try {
      const user = await this.prisma.withTenant(tenantId, (tx) =>
        tx.user.create({
          data: {
            tenantId,
            email: dto.email.toLowerCase(),
            passwordHash,
            role,
          },
        }),
      )
      return this.toAuthResult(user)
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('email already registered for this tenant')
      }
      throw err
    }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const tenantId = dto.tenantId as TenantId
    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email.toLowerCase() } },
      }),
    )
    if (!user || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('invalid credentials')
    }
    return this.toAuthResult(user)
  }

  private async toAuthResult(user: {
    id: number
    tenantId: number
    email: string
    role: string
  }): Promise<AuthResult> {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      scope: 'tenant',
    }
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.ttlSeconds })
    return {
      accessToken,
      user: { id: user.id, tenantId: user.tenantId, email: user.email, role: user.role },
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  )
}

export const JWT_TTL_TOKEN = JWT_TTL
