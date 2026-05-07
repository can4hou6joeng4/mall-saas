import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { PrismaClient } from '@prisma/client'

export interface TestUser {
  tenantId: number
  email: string
  password: string
  role?: 'admin' | 'user'
}

export async function registerAndLogin(
  app: NestFastifyApplication,
  user: TestUser,
): Promise<string> {
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: user,
  })
  if (reg.statusCode === 201) {
    return (reg.json() as { accessToken: string }).accessToken
  }
  if (reg.statusCode === 409) {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: user.tenantId, email: user.email, password: user.password },
    })
    if (login.statusCode === 200) {
      return (login.json() as { accessToken: string }).accessToken
    }
  }
  throw new Error(`registerAndLogin failed: ${reg.statusCode} ${reg.body}`)
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

export async function ensureTenants(owner: PrismaClient, ids: number[]): Promise<void> {
  for (const id of ids) {
    await owner.tenant.upsert({ where: { id }, update: {}, create: { id, name: `t${id}` } })
  }
}

export async function clearAuthData(owner: PrismaClient): Promise<void> {
  await owner.payment.deleteMany({})
  await owner.orderItem.deleteMany({})
  await owner.order.deleteMany({})
  await owner.user.deleteMany({})
}
