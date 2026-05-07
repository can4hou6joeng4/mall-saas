import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Redis } from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis

  onModuleInit(): void {
    const url = process.env['REDIS_URL']
    if (!url) throw new Error('REDIS_URL is required')
    this.client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false })
  }

  onModuleDestroy(): void {
    this.client?.disconnect()
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping()
      return reply === 'PONG'
    } catch {
      return false
    }
  }
}
