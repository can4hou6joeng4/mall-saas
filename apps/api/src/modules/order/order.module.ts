import { Module } from '@nestjs/common'
import { CouponModule } from '../coupon/coupon.module.js'
import { OrderController } from './order.controller.js'
import { OrderService } from './order.service.js'
import {
  ORDER_TIMEOUT_MS_TOKEN,
  OrderTimeoutQueue,
} from './order-timeout.queue.js'

@Module({
  imports: [CouponModule],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderTimeoutQueue,
    {
      provide: ORDER_TIMEOUT_MS_TOKEN,
      useFactory: (): number => Number(process.env['ORDER_TIMEOUT_MS'] ?? 30 * 60 * 1000),
    },
  ],
  exports: [OrderService, OrderTimeoutQueue],
})
export class OrderModule {}
