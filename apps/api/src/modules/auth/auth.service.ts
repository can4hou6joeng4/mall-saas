import { randomUUID } from 'node:crypto'
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
import { RedisService } from '../../common/redis/redis.service.js'
import { hashPassword, verifyPassword } from '../../common/auth/password.js'
import type {
  ConfirmPasswordResetDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestPasswordResetDto,
} from './auth.dto.js'

interface BaseTenantPayload {
  sub: number
  tenantId: number
  email: string
  role: string
  scope: 'tenant'
}

export interface AccessTokenPayload extends BaseTenantPayload {
  tokenType: 'access'
}

export interface RefreshTokenPayload extends BaseTenantPayload {
  tokenType: 'refresh'
  jti: string
}

export interface ResetTokenPayload {
  sub: number
  tenantId: number
  email: string
  scope: 'tenant'
  tokenType: 'reset'
  jti: string
}

export interface AuthResult {
  accessToken: string
  refreshToken: string
  user: { id: number; tenantId: number; email: string; role: string }
}

const JWT_TTL = 'JWT_TTL_SECONDS'
const REFRESH_TTL = 'JWT_REFRESH_TTL_SECONDS'
const RESET_TTL = 'PASSWORD_RESET_TTL_SECONDS'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    @Inject(JWT_TTL) private readonly accessTtl: number,
    @Inject(REFRESH_TTL) private readonly refreshTtl: number,
    @Inject(RESET_TTL) private readonly resetTtl: number,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const tenantId = dto.tenantId as TenantId
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException(`tenant ${tenantId} not found`)

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
      return this.issueTokens(user)
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
    if (user.locked) {
      throw new UnauthorizedException('account is locked')
    }
    return this.issueTokens(user)
  }

  async refresh(dto: RefreshDto): Promise<AuthResult> {
    let payload: RefreshTokenPayload
    try {
      payload = this.jwt.verify<RefreshTokenPayload>(dto.refreshToken)
    } catch {
      throw new UnauthorizedException('invalid or expired refresh token')
    }
    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('not a refresh token')
    }
    const exists = await this.redis.get(`auth:refresh:${payload.jti}`)
    if (!exists) {
      throw new UnauthorizedException('refresh token has been revoked')
    }
    // 旋转：删旧 jti，签发新一对
    await this.redis.del(`auth:refresh:${payload.jti}`)
    const tenantId = payload.tenantId as TenantId
    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: payload.sub } }),
    )
    if (!user) throw new UnauthorizedException('user no longer exists')
    return this.issueTokens(user)
  }

  async logout(dto: RefreshDto): Promise<void> {
    let payload: RefreshTokenPayload
    try {
      payload = this.jwt.verify<RefreshTokenPayload>(dto.refreshToken)
    } catch {
      // 静默接受 — 即使 token 无效也认为已登出
      return
    }
    if (payload.tokenType !== 'refresh') return
    await this.redis.del(`auth:refresh:${payload.jti}`)
  }

  async requestPasswordReset(
    dto: RequestPasswordResetDto,
  ): Promise<{ resetToken: string; expiresInSeconds: number }> {
    const tenantId = dto.tenantId as TenantId
    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email.toLowerCase() } },
      }),
    )
    // 不暴露 email 是否存在；不过为了 dev 友好，找不到就抛 404
    if (!user) throw new NotFoundException('user not found for this tenant')

    const jti = randomUUID()
    const payload: ResetTokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      scope: 'tenant',
      tokenType: 'reset',
      jti,
    }
    const resetToken = await this.jwt.signAsync(payload, { expiresIn: this.resetTtl })
    await this.redis.setex(
      `auth:reset:${jti}`,
      this.resetTtl,
      `${user.id}:${user.tenantId}`,
    )
    return { resetToken, expiresInSeconds: this.resetTtl }
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto): Promise<{ ok: true }> {
    let payload: ResetTokenPayload
    try {
      payload = this.jwt.verify<ResetTokenPayload>(dto.resetToken)
    } catch {
      throw new UnauthorizedException('invalid or expired reset token')
    }
    if (payload.tokenType !== 'reset') {
      throw new UnauthorizedException('not a reset token')
    }
    const exists = await this.redis.get(`auth:reset:${payload.jti}`)
    if (!exists) {
      throw new UnauthorizedException('reset token has been consumed or revoked')
    }
    const tenantId = payload.tenantId as TenantId
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: payload.sub },
        data: { passwordHash: hashPassword(dto.newPassword) },
      }),
    )
    await this.redis.del(`auth:reset:${payload.jti}`)
    return { ok: true }
  }

  private async issueTokens(user: {
    id: number
    tenantId: number
    email: string
    role: string
  }): Promise<AuthResult> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      scope: 'tenant',
      tokenType: 'access',
    }
    const jti = randomUUID()
    const refreshPayload: RefreshTokenPayload = { ...accessPayload, tokenType: 'refresh', jti }
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, { expiresIn: this.accessTtl }),
      this.jwt.signAsync(refreshPayload, { expiresIn: this.refreshTtl }),
    ])
    await this.redis.setex(
      `auth:refresh:${jti}`,
      this.refreshTtl,
      `${user.id}:${user.tenantId}`,
    )
    return {
      accessToken,
      refreshToken,
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
export const JWT_REFRESH_TTL_TOKEN = REFRESH_TTL
export const PASSWORD_RESET_TTL_TOKEN = RESET_TTL
