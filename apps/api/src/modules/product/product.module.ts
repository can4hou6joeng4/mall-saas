import { Module } from '@nestjs/common'
import { RolesGuard } from '../../common/auth/roles.guard.js'
import { ProductController } from './product.controller.js'
import { ProductService } from './product.service.js'

@Module({
  controllers: [ProductController],
  providers: [ProductService, RolesGuard],
})
export class ProductModule {}
