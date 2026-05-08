import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { CurrentTenant } from '../../common/tenant/index.js'
import { Roles } from '../../common/auth/roles.decorator.js'
import { RolesGuard } from '../../common/auth/roles.guard.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import {
  type CreateCouponDto,
  createCouponSchema,
  type ListCouponsQuery,
  listCouponsQuerySchema,
} from './coupon.dto.js'
import { CouponService } from './coupon.service.js'

@Controller('coupons')
@UseGuards(RolesGuard)
@Roles('admin')
export class CouponController {
  constructor(private readonly coupons: CouponService) {}

  @Post()
  create(
    @CurrentTenant() tenantId: TenantId,
    @Body(new ZodValidationPipe(createCouponSchema)) dto: CreateCouponDto,
  ) {
    return this.coupons.create(tenantId, dto)
  }

  @Get()
  list(
    @CurrentTenant() tenantId: TenantId,
    @Query(new ZodValidationPipe(listCouponsQuerySchema)) query: ListCouponsQuery,
  ) {
    return this.coupons.list(tenantId, query)
  }

  @Patch(':id/disable')
  @HttpCode(200)
  disable(@CurrentTenant() tenantId: TenantId, @Param('id', ParseIntPipe) id: number) {
    return this.coupons.disable(tenantId, id)
  }
}
