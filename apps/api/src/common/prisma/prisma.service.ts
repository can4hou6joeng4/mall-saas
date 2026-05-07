import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { TenantId } from '@mall/shared'

type TransactionalClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private superuser?: PrismaClient

  constructor() {
    const connectionString = process.env['DATABASE_APP_URL']
    if (!connectionString) {
      throw new Error('DATABASE_APP_URL is required to construct PrismaService')
    }
    super({ adapter: new PrismaPg({ connectionString }) })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
    await this.superuser?.$disconnect()
  }

  async withTenant<T>(
    tenantId: TenantId,
    fn: (tx: TransactionalClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${String(tenantId)}, true)`
      return fn(tx)
    })
  }

  // 仅供系统级路径使用（webhook 入口、超管巡检），用 DATABASE_URL 超管账号绕过 RLS。
  // 业务路径必须坚持走 withTenant，禁止用这个客户端做租户业务读写。
  getSuperuserClient(): PrismaClient {
    if (!this.superuser) {
      const url = process.env['DATABASE_URL']
      if (!url) throw new Error('DATABASE_URL is required for superuser client')
      this.superuser = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    }
    return this.superuser
  }
}
