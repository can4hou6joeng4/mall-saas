import { Module } from '@nestjs/common'
import { LoggerModule } from './common/logger/logger.module.js'
import { PingModule } from './modules/ping/ping.module.js'

@Module({ imports: [LoggerModule, PingModule] })
export class AppModule {}
