import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { hashPassword, verifyPassword } from '../../common/auth/password.js'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import type { AdminLoginDto } from './admin.dto.js'

export interface PlatformJwtPayload {
  sub: number
  email: string
  scope: 'platform'
}

export interface PlatformAuthResult {
  accessToken: string
  admin: { id: number; email: string }
}

const JWT_TTL = 'JWT_TTL_SECONDS'

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(JWT_TTL) private readonly ttlSeconds: number,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrap()
  }

  private async bootstrap(): Promise<void> {
    const email = process.env['PLATFORM_ADMIN_EMAIL']
    const password = process.env['PLATFORM_ADMIN_PASSWORD']
    if (!email || !password) {
      this.logger.log('PLATFORM_ADMIN_EMAIL/PASSWORD not set — skip bootstrap')
      return
    }
    const sys = this.prisma.getSuperuserClient()
    const existing = await sys.platformAdmin.count()
    if (existing > 0) {
      this.logger.log({ existing }, 'platform admins already present, skip bootstrap')
      return
    }
    await sys.platformAdmin.create({
      data: { email: email.toLowerCase(), passwordHash: hashPassword(password) },
    })
    this.logger.log({ email }, 'bootstrapped initial platform admin')
  }

  async login(dto: AdminLoginDto): Promise<PlatformAuthResult> {
    const sys = this.prisma.getSuperuserClient()
    const admin = await sys.platformAdmin.findUnique({
      where: { email: dto.email.toLowerCase() },
    })
    if (!admin || !verifyPassword(dto.password, admin.passwordHash)) {
      throw new UnauthorizedException('invalid platform admin credentials')
    }
    const payload: PlatformJwtPayload = {
      sub: admin.id,
      email: admin.email,
      scope: 'platform',
    }
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.ttlSeconds })
    return { accessToken, admin: { id: admin.id, email: admin.email } }
  }
}

export const ADMIN_JWT_TTL_TOKEN = JWT_TTL
