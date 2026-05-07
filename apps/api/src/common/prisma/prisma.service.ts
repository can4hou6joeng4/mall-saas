import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { TenantId } from '@mall/shared'

type TransactionalClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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
}
