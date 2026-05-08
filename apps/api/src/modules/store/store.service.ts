import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import { ORDER_STATUS } from '../order/order.service.js'
import type { ListStoreOrdersQuery } from './store.dto.js'

const LOW_STOCK_THRESHOLD = 5

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  // 商家视角：本租户所有订单（不限 userId），可按 status / userId 过滤
  listOrders(tenantId: TenantId, query: ListStoreOrdersQuery) {
    const { page, pageSize, status, userId } = query
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where: { status?: string; userId?: number } = {}
      if (status) where.status = status
      if (userId) where.userId = userId
      const [items, total] = await Promise.all([
        tx.order.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { items: true, user: { select: { id: true, email: true } } },
        }),
        tx.order.count({ where }),
      ])
      return { items, total, page, pageSize }
    })
  }

  // paid → shipped 状态推进（只允许 paid 订单发货；已 shipped 重复则 409）
  ship(tenantId: TenantId, orderId: number) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order) throw new NotFoundException(`order ${orderId} not found`)
      if (order.status === ORDER_STATUS.shipped) {
        throw new ConflictException(`order ${orderId} already shipped`)
      }
      if (order.status !== ORDER_STATUS.paid) {
        throw new ConflictException(
          `order ${orderId} cannot ship from status ${order.status}`,
        )
      }
      return tx.order.update({
        where: { id: orderId },
        data: { status: ORDER_STATUS.shipped },
        include: { items: true },
      })
    })
  }

  // 商家 dashboard 概览：按 status 分桶 + 商品计数 + 低库存数
  dashboard(tenantId: TenantId) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const grouped = await tx.order.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { totalCents: true },
      })
      const ordersByStatus: Record<string, { count: number; totalCents: number }> = {}
      for (const row of grouped) {
        ordersByStatus[row.status] = {
          count: row._count._all,
          totalCents: row._sum.totalCents ?? 0,
        }
      }
      const productCount = await tx.product.count()
      const lowStockProducts = await tx.product.count({
        where: { stock: { lte: LOW_STOCK_THRESHOLD } },
      })
      const reservedTotal = await tx.product.aggregate({
        _sum: { reservedStock: true },
      })
      return {
        ordersByStatus,
        productCount,
        lowStockProducts,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        reservedStockTotal: reservedTotal._sum.reservedStock ?? 0,
      }
    })
  }
}
