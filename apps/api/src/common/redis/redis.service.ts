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

  raw(): Redis {
    return this.client
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping()
      return reply === 'PONG'
    } catch {
      return false
    }
  }

  // INCR 后若 key 是新建的（首次自增），同时设置 TTL；返回当前计数
  async incrWithTTL(key: string, ttlSec: number): Promise<number> {
    const pipeline = this.client.multi().incr(key).expire(key, ttlSec, 'NX')
    const result = await pipeline.exec()
    if (!result) throw new Error('redis pipeline returned null')
    return result[0]?.[1] as number
  }

  async setex(key: string, ttlSec: number, value: string): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSec)
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }
}
