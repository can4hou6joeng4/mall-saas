import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { CurrentTenant, CurrentUser } from '../../common/tenant/index.js'
import type { RequestContext } from '../../common/tenant/index.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import {
  type CreateOrderDto,
  createOrderSchema,
  type ListOrdersQuery,
  listOrdersQuerySchema,
} from './order.dto.js'
import { OrderService } from './order.service.js'

@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  create(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Body(new ZodValidationPipe(createOrderSchema)) dto: CreateOrderDto,
  ) {
    return this.orders.create(tenantId, user.userId, dto)
  }

  @Get()
  list(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
  ) {
    return this.orders.list(tenantId, user.userId, query)
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.findOne(tenantId, user.userId, id)
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.cancel(tenantId, user.userId, id)
  }
}
