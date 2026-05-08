import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { bearer, clearAuthData, ensureTenants, registerAndLogin } from './_helpers.js'
import { registerFastifyPlugins } from '../../src/bootstrap/fastify-plugins.js'

const SUPERUSER_URL = 'postgresql://mall:mall@localhost:5432/mall?schema=public'
const APP_URL = 'postgresql://mall_app:mall_app@localhost:5432/mall?schema=public'

describe('Product images upload (e2e)', () => {
  let app: NestFastifyApplication
  let owner: PrismaClient
  let adminToken: string
  let userToken: string
  let productId = 0
  let tmpRoot = ''

  beforeAll(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mall-uploads-'))
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = SUPERUSER_URL
    process.env['DATABASE_APP_URL'] = APP_URL
    process.env['REDIS_URL'] = 'redis://localhost:6379/0'
    process.env['LOG_LEVEL'] = 'error'
    process.env['JWT_SECRET'] = 'a'.repeat(64)
    process.env['JWT_TTL_SECONDS'] = '900'
    process.env['JWT_REFRESH_TTL_SECONDS'] = '604800'
    process.env['PAYMENT_MOCK_SECRET'] = 'e2e-mock-secret-16chars'
    process.env['AUTH_RATE_LIMIT_MAX'] = '9999'
    process.env['STORAGE_LOCAL_DIR'] = tmpRoot
    process.env['STORAGE_PUBLIC_BASE'] = '/uploads'

    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: SUPERUSER_URL }) })
    await owner.productImage.deleteMany({})
    await clearAuthData(owner)
    await owner.product.deleteMany({})
    await ensureTenants(owner, [66])

    const { AppModule } = await import('../../src/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await registerFastifyPlugins(app)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    adminToken = await registerAndLogin(app, {
      tenantId: 66,
      email: 'admin@t66.dev',
      password: 'p@ssw0rd!',
      role: 'admin',
    })
    userToken = await registerAndLogin(app, {
      tenantId: 66,
      email: 'shopper@t66.dev',
      password: 'p@ssw0rd!',
      role: 'user',
    })

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: bearer(adminToken),
      payload: { name: 'Imageable', priceCents: 1000, stock: 1 },
    })
    productId = (created.json() as { id: number }).id
  })

  afterAll(async () => {
    await app.close()
    await owner.$disconnect()
    rmSync(tmpRoot, { recursive: true, force: true })
    delete process.env['AUTH_RATE_LIMIT_MAX']
    delete process.env['STORAGE_LOCAL_DIR']
    delete process.env['STORAGE_PUBLIC_BASE']
  })

  function multipart(body: Buffer, filename: string, mime: string) {
    const boundary = '----test-boundary-m16'
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    return {
      payload: Buffer.concat([head, body, tail]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    }
  }

  it('non-admin cannot upload (403)', async () => {
    // 1x1 png
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    const m = multipart(png, 't.png', 'image/png')
    const r = await app.inject({
      method: 'POST',
      url: `/products/${productId}/images`,
      headers: { ...bearer(userToken), 'content-type': m.contentType },
      payload: m.payload,
    })
    expect(r.statusCode).toBe(403)
  })

  it('admin uploads a png and lists it', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    const m = multipart(png, 'thumb.png', 'image/png')
    const up = await app.inject({
      method: 'POST',
      url: `/products/${productId}/images`,
      headers: { ...bearer(adminToken), 'content-type': m.contentType },
      payload: m.payload,
    })
    expect(up.statusCode).toBe(201)
    const body = up.json() as {
      id: number
      productId: number
      url: string
      contentType: string
      byteSize: number
      position: number
    }
    expect(body.productId).toBe(productId)
    expect(body.contentType).toBe('image/png')
    expect(body.position).toBe(0)
    expect(body.url.startsWith('/uploads/tenant-66/')).toBe(true)

    const list = await app.inject({
      method: 'GET',
      url: `/products/${productId}/images`,
      headers: bearer(userToken), // 任意 tenant 用户都可以查图
    })
    expect(list.statusCode).toBe(200)
    const items = list.json() as { id: number }[]
    expect(items.length).toBe(1)
  })

  it('rejects unsupported content type with 409', async () => {
    const txt = Buffer.from('plain text body')
    const m = multipart(txt, 'note.txt', 'text/plain')
    const r = await app.inject({
      method: 'POST',
      url: `/products/${productId}/images`,
      headers: { ...bearer(adminToken), 'content-type': m.contentType },
      payload: m.payload,
    })
    expect(r.statusCode).toBe(409)
  })

  it('admin can delete an image (204)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/products/${productId}/images`,
      headers: bearer(adminToken),
    })
    const items = list.json() as { id: number }[]
    const id = items[0]!.id
    const r = await app.inject({
      method: 'DELETE',
      url: `/images/${id}`,
      headers: bearer(adminToken),
    })
    expect(r.statusCode).toBe(204)

    const after = await app.inject({
      method: 'GET',
      url: `/products/${productId}/images`,
      headers: bearer(adminToken),
    })
    expect((after.json() as unknown[]).length).toBe(0)
  })
})
