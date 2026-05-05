import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module.js'
import { LoggerModule } from './common/logger/logger.module.js'
import { PingModule } from './modules/ping/ping.module.js'

@Module({ imports: [ConfigModule, LoggerModule, PingModule] })
export class AppModule {}
