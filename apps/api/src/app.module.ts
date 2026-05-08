import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module.js'
import { LoggerModule } from './common/logger/logger.module.js'
import { PrismaModule } from './common/prisma/prisma.module.js'
import { RedisModule } from './common/redis/redis.module.js'
import { HealthModule } from './common/health/health.module.js'
import { TenantModule } from './common/tenant/tenant.module.js'
import { ExceptionsModule } from './common/exceptions/exceptions.module.js'
import { MetricsModule } from './common/metrics/metrics.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { PingModule } from './modules/ping/ping.module.js'
import { ProductModule } from './modules/product/product.module.js'
import { OrderModule } from './modules/order/order.module.js'
import { PaymentModule } from './modules/payment/payment.module.js'
import { CartModule } from './modules/cart/cart.module.js'
import { StoreModule } from './modules/store/store.module.js'
import { AdminModule } from './modules/admin/admin.module.js'

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    TenantModule,
    ExceptionsModule,
    MetricsModule,
    AuthModule,
    PingModule,
    ProductModule,
    OrderModule,
    PaymentModule,
    CartModule,
    StoreModule,
    AdminModule,
  ],
})
export class AppModule {}
