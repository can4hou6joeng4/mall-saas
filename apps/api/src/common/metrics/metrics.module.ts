import { Global, Module } from '@nestjs/common'
import { MetricsController } from './metrics.controller.js'
import { MetricsService } from './metrics.service.js'

@Global()
@Module({
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
