import { Module } from '@nestjs/common'
import { RolesGuard } from '../../common/auth/roles.guard.js'
import { CouponController } from './coupon.controller.js'
import { CouponService } from './coupon.service.js'

@Module({
  controllers: [CouponController],
  providers: [CouponService, RolesGuard],
  exports: [CouponService],
})
export class CouponModule {}
