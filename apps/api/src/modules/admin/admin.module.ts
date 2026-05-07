import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { AdminAuthMiddleware } from './admin-auth.middleware.js'
import { AdminAuthService, ADMIN_JWT_TTL_TOKEN } from './admin-auth.service.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    AdminAuthService,
    AdminService,
    AdminAuthMiddleware,
    {
      provide: ADMIN_JWT_TTL_TOKEN,
      useFactory: (): number => Number(process.env['JWT_TTL_SECONDS'] ?? 3600),
    },
  ],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // /admin/auth/* 是 platform 登录入口，不能要求 platform token；其余 /admin/* 必须 platform token
    consumer
      .apply(AdminAuthMiddleware)
      .exclude('admin/auth/(.*)')
      .forRoutes('admin/(.*)')
  }
}
