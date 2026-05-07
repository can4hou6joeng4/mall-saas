import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { CurrentTenant } from '../../common/tenant/index.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import {
  type CreateProductDto,
  createProductSchema,
  type ListProductsQuery,
  listProductsQuerySchema,
  type UpdateProductDto,
  updateProductSchema,
} from './product.dto.js'
import { ProductService } from './product.service.js'

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  create(
    @CurrentTenant() tenantId: TenantId,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto,
  ) {
    return this.products.create(tenantId, dto)
  }

  @Get()
  list(
    @CurrentTenant() tenantId: TenantId,
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery,
  ) {
    return this.products.list(tenantId, query)
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: TenantId, @Param('id', ParseIntPipe) id: number) {
    return this.products.findById(tenantId, id)
  }

  @Put(':id')
  update(
    @CurrentTenant() tenantId: TenantId,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductDto,
  ) {
    return this.products.update(tenantId, id, dto)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentTenant() tenantId: TenantId, @Param('id', ParseIntPipe) id: number) {
    await this.products.remove(tenantId, id)
  }
}
