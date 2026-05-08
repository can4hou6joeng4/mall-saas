import { Module } from '@nestjs/common'
import { RolesGuard } from '../../common/auth/roles.guard.js'
import { StoreController } from './store.controller.js'
import { StoreService } from './store.service.js'

@Module({
  controllers: [StoreController],
  providers: [StoreService, RolesGuard],
})
export class StoreModule {}
