import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import {
  type LoginDto,
  loginSchema,
  type RegisterDto,
  registerSchema,
} from './auth.dto.js'
import { AuthService, type AuthResult } from './auth.service.js'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto)
  }

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto)
  }
}
