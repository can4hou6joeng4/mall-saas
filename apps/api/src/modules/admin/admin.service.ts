import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import { hashPassword } from '../../common/auth/password.js'
import type {
  CreateTenantDto,
  ListOrdersAdminQuery,
  ListPaymentsAdminQuery,
  ListUsersAdminQuery,
  UpdateTenantDto,
} from './admin.dto.js'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 平台元数据：Tenant 表无 RLS，superuser 直接读写
  listTenants() {
    return this.prisma.getSuperuserClient().tenant.findMany({ orderBy: { id: 'asc' } })
  }

  createTenant(dto: CreateTenantDto) {
    return this.prisma.getSuperuserClient().tenant.create({ data: { name: dto.name } })
  }

  async updateTenant(id: number, dto: UpdateTenantDto) {
    const sys = this.prisma.getSuperuserClient()
    const existing = await sys.tenant.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`tenant ${id} not found`)
    return sys.tenant.update({ where: { id }, data: { name: dto.name } })
  }

  // 平台运营视角的租户健康度详情：元数据 + 订单状态分桶 + 商品/用户计数 + paid 订单累计营收
  async findTenantDetail(id: number) {
    const sys = this.prisma.getSuperuserClient()
    const tenant = await sys.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException(`tenant ${id} not found`)
    const [grouped, productCount, userCount, paidAggregate] = await Promise.all([
      sys.order.groupBy({
        by: ['status'],
        where: { tenantId: id },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      sys.product.count({ where: { tenantId: id } }),
      sys.user.count({ where: { tenantId: id } }),
      sys.order.aggregate({
        where: { tenantId: id, status: 'paid' },
        _sum: { totalCents: true },
      }),
    ])
    const ordersByStatus: Record<string, { count: number; totalCents: number }> = {}
    for (const row of grouped) {
      ordersByStatus[row.status] = {
        count: row._count._all,
        totalCents: row._sum.totalCents ?? 0,
      }
    }
    return {
      ...tenant,
      ordersByStatus,
      productCount,
      userCount,
      paidRevenueCents: paidAggregate._sum.totalCents ?? 0,
    }
  }

  async deleteTenant(id: number): Promise<void> {
    const sys = this.prisma.getSuperuserClient()
    const existing = await sys.tenant.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`tenant ${id} not found`)
    const [users, products, orders] = await Promise.all([
      sys.user.count({ where: { tenantId: id } }),
      sys.product.count({ where: { tenantId: id } }),
      sys.order.count({ where: { tenantId: id } }),
    ])
    if (users + products + orders > 0) {
      throw new ConflictException(
        `tenant ${id} still owns ${users} user(s) / ${products} product(s) / ${orders} order(s)`,
      )
    }
    await sys.tenant.delete({ where: { id } })
  }

  async listOrders(query: ListOrdersAdminQuery) {
    const { page, pageSize, tenantId, status } = query
    const where: { tenantId?: number; status?: string } = {}
    if (tenantId !== undefined) where.tenantId = tenantId
    if (status !== undefined) where.status = status
    const sys = this.prisma.getSuperuserClient()
    const [items, total] = await Promise.all([
      sys.order.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: true },
      }),
      sys.order.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  async listPayments(query: ListPaymentsAdminQuery) {
    const { page, pageSize, tenantId, status } = query
    const where: { tenantId?: number; status?: string } = {}
    if (tenantId !== undefined) where.tenantId = tenantId
    if (status !== undefined) where.status = status
    const sys = this.prisma.getSuperuserClient()
    const [items, total] = await Promise.all([
      sys.payment.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      sys.payment.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  // 平台运营排查异常支付：payment + 关联 order(含 items) + 关联 tenant
  async findPaymentDetail(id: number) {
    const sys = this.prisma.getSuperuserClient()
    const payment = await sys.payment.findUnique({
      where: { id },
      include: {
        order: { include: { items: true } },
        tenant: { select: { id: true, name: true, createdAt: true } },
      },
    })
    if (!payment) throw new NotFoundException(`payment ${id} not found`)
    return payment
  }

  // 跨租户用户列表（不返回 passwordHash）
  async listUsers(query: ListUsersAdminQuery) {
    const { page, pageSize, tenantId, email, role, locked } = query
    const where: { tenantId?: number; email?: { contains: string }; role?: string; locked?: boolean } = {}
    if (tenantId !== undefined) where.tenantId = tenantId
    if (email !== undefined && email.length > 0) where.email = { contains: email }
    if (role !== undefined) where.role = role
    if (locked !== undefined) where.locked = locked === 'true'
    const sys = this.prisma.getSuperuserClient()
    const [items, total] = await Promise.all([
      sys.user.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          tenantId: true,
          email: true,
          role: true,
          locked: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      sys.user.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  async setUserLocked(id: number, locked: boolean) {
    const sys = this.prisma.getSuperuserClient()
    const existing = await sys.user.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`user ${id} not found`)
    return sys.user.update({
      where: { id },
      data: { locked },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        locked: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  }

  // 一次性临时密码：随机 16 字节 → base64url 截 16 字符；写 hash 不存明文；
  // 不解锁（lock 状态独立，避免 reset 绕过 lock）。
  async resetUserPassword(id: number) {
    const sys = this.prisma.getSuperuserClient()
    const existing = await sys.user.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`user ${id} not found`)
    const temporaryPassword = randomBytes(12).toString('base64url').slice(0, 16)
    const user = await sys.user.update({
      where: { id },
      data: { passwordHash: hashPassword(temporaryPassword) },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        locked: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return { user, temporaryPassword }
  }
}
