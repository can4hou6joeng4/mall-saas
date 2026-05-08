import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { TenantId } from '@mall/shared'
import { CurrentTenant } from '../../common/tenant/index.js'
import { Roles } from '../../common/auth/roles.decorator.js'
import { RolesGuard } from '../../common/auth/roles.guard.js'
import { ProductImageService } from './product-image.service.js'

@Controller()
@UseGuards(RolesGuard)
export class ProductImageController {
  constructor(private readonly images: ProductImageService) {}

  @Get('products/:productId/images')
  list(
    @CurrentTenant() tenantId: TenantId,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.images.list(tenantId, productId)
  }

  @Post('products/:productId/images')
  @Roles('admin')
  @HttpCode(201)
  async upload(
    @CurrentTenant() tenantId: TenantId,
    @Param('productId', ParseIntPipe) productId: number,
    @Req() req: FastifyRequest,
  ) {
    const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } })
    if (!file) {
      throw new Error('multipart file is required')
    }
    const buffer = await file.toBuffer()
    return this.images.upload(tenantId, productId, {
      buffer,
      filename: file.filename,
      contentType: file.mimetype,
    })
  }

  @Delete('images/:id')
  @Roles('admin')
  @HttpCode(204)
  async remove(
    @CurrentTenant() tenantId: TenantId,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.images.remove(tenantId, id)
  }
}
