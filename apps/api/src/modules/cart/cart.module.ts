import { Module } from '@nestjs/common'
import { OrderModule } from '../order/order.module.js'
import { CartController } from './cart.controller.js'
import { CartService } from './cart.service.js'

@Module({
  imports: [OrderModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
