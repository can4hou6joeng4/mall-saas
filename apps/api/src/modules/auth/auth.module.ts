import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthRateLimitGuard } from '../../common/auth/auth-rate-limit.guard.js'
import { AuthController } from './auth.controller.js'
import {
  AuthService,
  JWT_REFRESH_TTL_TOKEN,
  JWT_TTL_TOKEN,
  PASSWORD_RESET_TTL_TOKEN,
} from './auth.service.js'

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret) throw new Error('JWT_SECRET is required')
        return { secret }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitGuard,
    {
      provide: JWT_TTL_TOKEN,
      useFactory: (): number => Number(process.env['JWT_TTL_SECONDS'] ?? 900),
    },
    {
      provide: JWT_REFRESH_TTL_TOKEN,
      useFactory: (): number =>
        Number(process.env['JWT_REFRESH_TTL_SECONDS'] ?? 7 * 24 * 3600),
    },
    {
      provide: PASSWORD_RESET_TTL_TOKEN,
      useFactory: (): number => Number(process.env['PASSWORD_RESET_TTL_SECONDS'] ?? 600),
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
