import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../src/common/prisma/prisma.service.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

const tid = (n: number): TenantId => n as TenantId

describe('RLS isolation via PrismaService.withTenant (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let prisma: PrismaService

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '3600'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await owner.tenant.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: 't1' } })
    await owner.tenant.upsert({ where: { id: 2 }, update: {}, create: { id: 2, name: 't2' } })
    await owner.note.deleteMany({})
    await owner.note.create({ data: { tenantId: 1, content: 'note for tenant 1' } })
    await owner.note.create({ data: { tenantId: 2, content: 'note for tenant 2' } })

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
  })

  it('withTenant(1) sees only tenant 1 notes', async () => {
    const notes = await prisma.withTenant(tid(1), (tx) => tx.note.findMany())
    expect(notes).toHaveLength(1)
    expect(notes[0]?.tenantId).toBe(1)
  })

  it('withTenant(2) sees only tenant 2 notes', async () => {
    const notes = await prisma.withTenant(tid(2), (tx) => tx.note.findMany())
    expect(notes).toHaveLength(1)
    expect(notes[0]?.tenantId).toBe(2)
  })

  it('querying outside withTenant returns no rows (RLS denies)', async () => {
    const rows = await prisma.note.findMany()
    expect(rows).toHaveLength(0)
  })
})
