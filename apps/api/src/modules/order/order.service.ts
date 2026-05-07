import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import type { CreateOrderDto, ListOrdersQuery } from './order.dto.js'

export const ORDER_STATUS = {
  pending: 'pending',
  paid: 'paid',
  cancelled: 'cancelled',
} as const
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: TenantId, userId: number, dto: CreateOrderDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ids = dto.items.map((i) => i.productId)
      const products = await tx.product.findMany({ where: { id: { in: ids } } })
      if (products.length !== new Set(ids).size) {
        throw new NotFoundException('one or more products not found')
      }
      const priceMap = new Map(products.map((p) => [p.id, p.priceCents]))

      // 原子扣减库存：UPDATE WHERE stock >= q —— 0 行受影响即代表库存不足
      // 在 RLS 作用域下，跨租户商品自然返回 0 行（已在上一步 findMany 校验）
      for (const item of dto.items) {
        const affected = await tx.$executeRaw`
          UPDATE "Product"
          SET stock = stock - ${item.quantity}
          WHERE id = ${item.productId} AND stock >= ${item.quantity}
        `
        if (affected === 0) {
          throw new ConflictException(
            `insufficient stock for product ${item.productId}`,
          )
        }
      }

      const itemsWithPrice = dto.items.map((item) => {
        const unit = priceMap.get(item.productId)!
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCents: unit,
          subtotalCents: unit * item.quantity,
        }
      })
      const totalCents = itemsWithPrice.reduce((s, i) => s + i.subtotalCents, 0)

      return tx.order.create({
        data: {
          tenantId,
          userId,
          totalCents,
          status: ORDER_STATUS.pending,
          items: { create: itemsWithPrice },
        },
        include: { items: true },
      })
    })
  }

  list(tenantId: TenantId, userId: number, query: ListOrdersQuery) {
    const { page, pageSize, status } = query
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = status === undefined ? { userId } : { userId, status }
      const [items, total] = await Promise.all([
        tx.order.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { items: true },
        }),
        tx.order.count({ where }),
      ])
      return { items, total, page, pageSize }
    })
  }

  async findOne(tenantId: TenantId, userId: number, id: number) {
    const order = await this.prisma.withTenant(tenantId, (tx) =>
      tx.order.findUnique({ where: { id }, include: { items: true } }),
    )
    if (!order || order.userId !== userId) {
      throw new NotFoundException(`order ${id} not found`)
    }
    return order
  }

  cancel(tenantId: TenantId, userId: number, id: number) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      })
      if (!order || order.userId !== userId) {
        throw new NotFoundException(`order ${id} not found`)
      }
      if (order.status !== ORDER_STATUS.pending) {
        throw new ConflictException(
          `order ${id} cannot be cancelled from status ${order.status}`,
        )
      }
      // 回滚库存
      for (const item of order.items) {
        await tx.$executeRaw`
          UPDATE "Product" SET stock = stock + ${item.quantity}
          WHERE id = ${item.productId}
        `
      }
      return tx.order.update({
        where: { id },
        data: { status: ORDER_STATUS.cancelled },
        include: { items: true },
      })
    })
  }
}
