import { Module } from '@nestjs/common'
import { OrderModule } from '../order/order.module.js'
import { PaymentController } from './payment.controller.js'
import { PaymentService } from './payment.service.js'
import { MockPaymentProvider } from './provider/mock-payment-provider.js'
import { PaymentProviderRegistry } from './provider/payment-provider.registry.js'

@Module({
  imports: [OrderModule],
  controllers: [PaymentController],
  providers: [PaymentService, MockPaymentProvider, PaymentProviderRegistry],
  exports: [PaymentService, MockPaymentProvider],
})
export class PaymentModule {}
