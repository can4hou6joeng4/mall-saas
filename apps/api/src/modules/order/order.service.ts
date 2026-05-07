import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import type { CreateOrderDto, ListOrdersQuery } from './order.dto.js'
import { OrderTimeoutQueue } from './order-timeout.queue.js'

export const ORDER_STATUS = {
  pending: 'pending',
  paid: 'paid',
  cancelled: 'cancelled',
} as const
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeoutQueue: OrderTimeoutQueue,
  ) {}

  async create(tenantId: TenantId, userId: number, dto: CreateOrderDto) {
    const order = await this.prisma.withTenant(tenantId, async (tx) => {
      const ids = dto.items.map((i) => i.productId)
      const products = await tx.product.findMany({ where: { id: { in: ids } } })
      if (products.length !== new Set(ids).size) {
        throw new NotFoundException('one or more products not found')
      }
      const priceMap = new Map(products.map((p) => [p.id, p.priceCents]))

      for (const item of dto.items) {
        // 仅预占（不真扣 stock）：要求 reservedStock + q <= stock
        const affected = await tx.$executeRaw`
          UPDATE "Product"
          SET "reservedStock" = "reservedStock" + ${item.quantity}
          WHERE id = ${item.productId}
            AND "reservedStock" + ${item.quantity} <= stock
        `
        if (affected === 0) {
          throw new ConflictException(
            `insufficient available stock for product ${item.productId}`,
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

    await this.timeoutQueue.enqueue({ tenantId, orderId: order.id })
    return order
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
      for (const item of order.items) {
        await tx.$executeRaw`
          UPDATE "Product" SET "reservedStock" = "reservedStock" - ${item.quantity}
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

  // 幂等取消：仅当订单仍处于 pending 时释放预占并取消，否则返回 false（用于异步超时任务）
  cancelIfPending(tenantId: TenantId, id: number): Promise<boolean> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      })
      if (!order || order.status !== ORDER_STATUS.pending) return false
      for (const item of order.items) {
        await tx.$executeRaw`
          UPDATE "Product" SET "reservedStock" = "reservedStock" - ${item.quantity}
          WHERE id = ${item.productId}
        `
      }
      await tx.order.update({
        where: { id },
        data: { status: ORDER_STATUS.cancelled },
      })
      return true
    })
  }

  // 幂等确认：仅当订单仍处于 pending 时把预占转成实扣并标记 paid，否则返回 false（用于支付 webhook 成功）
  confirmIfPending(tenantId: TenantId, id: number): Promise<boolean> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      })
      if (!order || order.status !== ORDER_STATUS.pending) return false
      for (const item of order.items) {
        await tx.$executeRaw`
          UPDATE "Product"
          SET stock = stock - ${item.quantity},
              "reservedStock" = "reservedStock" - ${item.quantity}
          WHERE id = ${item.productId}
        `
      }
      await tx.order.update({
        where: { id },
        data: { status: ORDER_STATUS.paid },
      })
      return true
    })
  }
}
