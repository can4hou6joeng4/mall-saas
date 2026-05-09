import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
  type ListStoreOrdersQuery,
  listStoreOrdersQuerySchema,
} from './store.dto.js'
import { StoreService } from './store.service.js'

@Controller('store')
@UseGuards(RolesGuard)
@Roles('admin')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get('orders')
  listOrders(
    @CurrentTenant() tenantId: TenantId,
    @Query(new ZodValidationPipe(listStoreOrdersQuerySchema)) query: ListStoreOrdersQuery,
  ) {
    return this.store.listOrders(tenantId, query)
  }

  @Get('orders/:id')
  findOrder(
    @CurrentTenant() tenantId: TenantId,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.store.findOne(tenantId, id)
  }

  @Post('orders/:id/ship')
  @HttpCode(200)
  ship(@CurrentTenant() tenantId: TenantId, @Param('id', ParseIntPipe) id: number) {
    return this.store.ship(tenantId, id)
  }

  @Get('dashboard')
  dashboard(@CurrentTenant() tenantId: TenantId) {
    return this.store.dashboard(tenantId)
  }
}
