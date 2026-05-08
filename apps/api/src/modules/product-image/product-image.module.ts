import { Module } from '@nestjs/common'
import { RolesGuard } from '../../common/auth/roles.guard.js'
import { ProductImageController } from './product-image.controller.js'
import { ProductImageService } from './product-image.service.js'

@Module({
  controllers: [ProductImageController],
  providers: [ProductImageService, RolesGuard],
})
export class ProductImageModule {}
