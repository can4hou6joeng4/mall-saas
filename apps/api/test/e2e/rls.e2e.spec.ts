import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('RLS isolation (e2e)', () => {
  let app: NestFastifyApplication
  let appPrisma: PrismaClient
  type RowCount = { count: bigint }

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    const { PrismaService } = await import('../../src/common/prisma/prisma.service.js')
    const ownerPrisma = app.get(PrismaService)

    await ownerPrisma.tenant.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: 't1' } })
    await ownerPrisma.tenant.upsert({ where: { id: 2 }, update: {}, create: { id: 2, name: 't2' } })
    await ownerPrisma.note.deleteMany({})
    await ownerPrisma.note.create({ data: { tenantId: 1, content: 'note for tenant 1' } })
    await ownerPrisma.note.create({ data: { tenantId: 2, content: 'note for tenant 2' } })

    appPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: APP_URL }),
    })
  })

  afterAll(async () => {
    await appPrisma.$disconnect()
    await app.close()
  })

  it('mall_app sees only tenant 1 notes when app.current_tenant=1', async () => {
    const rows = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '1'`)
      return tx.$queryRawUnsafe<RowCount[]>(`SELECT count(*)::bigint AS count FROM "Note"`)
    })
    expect(Number(rows[0]?.count)).toBe(1)
  })

  it('mall_app sees only tenant 2 notes when app.current_tenant=2', async () => {
    const rows = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '2'`)
      return tx.$queryRawUnsafe<RowCount[]>(`SELECT count(*)::bigint AS count FROM "Note"`)
    })
    expect(Number(rows[0]?.count)).toBe(1)
  })

  it('mall_app sees no rows without app.current_tenant set', async () => {
    const rows = await appPrisma.$queryRawUnsafe<RowCount[]>(
      `SELECT count(*)::bigint AS count FROM "Note"`,
    )
    expect(Number(rows[0]?.count)).toBe(0)
  })
})
