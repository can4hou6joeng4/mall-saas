import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import type {
  CreateTenantDto,
  ListOrdersAdminQuery,
  ListPaymentsAdminQuery,
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
}
