import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { TenantMiddleware } from './tenant.middleware.js'

@Module({
  providers: [TenantMiddleware],
  exports: [TenantMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude('healthz', 'readyz', 'docs', 'docs/(.*)', 'auth/(.*)')
      .forRoutes('*')
  }
}
