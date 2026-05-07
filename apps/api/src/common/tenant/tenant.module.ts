import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { AuthModule } from '../../modules/auth/auth.module.js'
import { AuthMiddleware } from './auth.middleware.js'

@Module({
  imports: [AuthModule],
  providers: [AuthMiddleware],
  exports: [AuthMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthMiddleware)
      .exclude(
        'healthz',
        'readyz',
        'docs',
        'docs/(.*)',
        'docs-json',
        'docs-yaml',
        'metrics',
        'auth/(.*)',
        'webhooks/(.*)',
        'admin/(.*)',
      )
      .forRoutes('*')
  }
}
