import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module.js'
import { LoggerModule } from './common/logger/logger.module.js'
import { PrismaModule } from './common/prisma/prisma.module.js'
import { HealthModule } from './common/health/health.module.js'
import { TenantModule } from './common/tenant/tenant.module.js'
import { ExceptionsModule } from './common/exceptions/exceptions.module.js'
import { PingModule } from './modules/ping/ping.module.js'
import { ProductModule } from './modules/product/product.module.js'

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    HealthModule,
    TenantModule,
    ExceptionsModule,
    PingModule,
    ProductModule,
  ],
})
export class AppModule {}
