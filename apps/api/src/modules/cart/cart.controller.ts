import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { CurrentTenant, CurrentUser } from '../../common/tenant/index.js'
import type { RequestContext } from '../../common/tenant/index.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import {
  type AddCartItemDto,
  addCartItemSchema,
  type UpdateCartItemDto,
  updateCartItemSchema,
} from './cart.dto.js'
import { CartService } from './cart.service.js'

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  list(@CurrentTenant() tenantId: TenantId, @CurrentUser() user: RequestContext) {
    return this.cart.list(tenantId, user.userId)
  }

  @Post('items')
  @HttpCode(200)
  add(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Body(new ZodValidationPipe(addCartItemSchema)) dto: AddCartItemDto,
  ) {
    return this.cart.addItem(tenantId, user.userId, dto)
  }

  @Patch('items/:productId')
  update(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Param('productId', ParseIntPipe) productId: number,
    @Body(new ZodValidationPipe(updateCartItemSchema)) dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(tenantId, user.userId, productId, dto)
  }

  @Delete('items/:productId')
  @HttpCode(204)
  async remove(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    await this.cart.removeItem(tenantId, user.userId, productId)
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentTenant() tenantId: TenantId, @CurrentUser() user: RequestContext) {
    await this.cart.clear(tenantId, user.userId)
  }

  @Post('checkout')
  @HttpCode(201)
  checkout(@CurrentTenant() tenantId: TenantId, @CurrentUser() user: RequestContext) {
    return this.cart.checkout(tenantId, user.userId)
  }
}
