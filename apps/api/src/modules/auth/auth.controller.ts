import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { AuthRateLimitGuard } from '../../common/auth/auth-rate-limit.guard.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import {
  type ConfirmPasswordResetDto,
  confirmPasswordResetSchema,
  type LoginDto,
  loginSchema,
  type RefreshDto,
  refreshSchema,
  type RegisterDto,
  registerSchema,
  type RequestPasswordResetDto,
  requestPasswordResetSchema,
} from './auth.dto.js'
import { AuthService, type AuthResult } from './auth.service.js'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto)
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto)
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto): Promise<AuthResult> {
    return this.auth.refresh(dto)
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto)
  }

  @Post('password-reset/request')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  requestPasswordReset(
    @Body(new ZodValidationPipe(requestPasswordResetSchema))
    dto: RequestPasswordResetDto,
  ): Promise<{ resetToken: string; expiresInSeconds: number }> {
    return this.auth.requestPasswordReset(dto)
  }

  @Post('password-reset/confirm')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  confirmPasswordReset(
    @Body(new ZodValidationPipe(confirmPasswordResetSchema))
    dto: ConfirmPasswordResetDto,
  ): Promise<{ ok: true }> {
    return this.auth.confirmPasswordReset(dto)
  }
}
