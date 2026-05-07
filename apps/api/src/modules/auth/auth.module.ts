import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller.js'
import { AuthService, JWT_TTL_TOKEN } from './auth.service.js'

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
    {
      provide: JWT_TTL_TOKEN,
      useFactory: (): number => Number(process.env['JWT_TTL_SECONDS'] ?? 3600),
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
