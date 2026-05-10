import { Injectable, NotFoundException } from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import { OrderService } from '../order/order.service.js'
import type { AddCartItemDto, UpdateCartItemDto } from './cart.dto.js'

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  list(tenantId: TenantId, userId: number) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.cartItem.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        include: { product: true },
      }),
    )
  }

  async addItem(tenantId: TenantId, userId: number, dto: AddCartItemDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } })
      if (!product) throw new NotFoundException(`product ${dto.productId} not found`)
      // 同 productId 已存在则累加 quantity
      return tx.cartItem.upsert({
        where: {
          tenantId_userId_productId: {
            tenantId,
            userId,
            productId: dto.productId,
          },
        },
        update: { quantity: { increment: dto.quantity } },
        create: { tenantId, userId, productId: dto.productId, quantity: dto.quantity },
      })
    })
  }

  async updateItem(
    tenantId: TenantId,
    userId: number,
    productId: number,
    dto: UpdateCartItemDto,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.cartItem.findUnique({
        where: { tenantId_userId_productId: { tenantId, userId, productId } },
      })
      if (!existing) throw new NotFoundException(`cart item for product ${productId} not found`)
      return tx.cartItem.update({
        where: { tenantId_userId_productId: { tenantId, userId, productId } },
        data: { quantity: dto.quantity },
      })
    })
  }

  async removeItem(tenantId: TenantId, userId: number, productId: number) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.cartItem.findUnique({
        where: { tenantId_userId_productId: { tenantId, userId, productId } },
      })
      if (!existing) throw new NotFoundException(`cart item for product ${productId} not found`)
      await tx.cartItem.delete({
        where: { tenantId_userId_productId: { tenantId, userId, productId } },
      })
    })
  }

  async clear(tenantId: TenantId, userId: number) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.cartItem.deleteMany({ where: { userId } }),
    )
  }

  // checkout：将当前购物车物化为一个订单（走 OrderService 复用预占语义），成功后清空购物车
  // 失败（库存/无效 couponCode/coupon usage limit）时不会清空购物车——保留给用户重试
  async checkout(tenantId: TenantId, userId: number, couponCode?: string) {
    const items = await this.prisma.withTenant(tenantId, (tx) =>
      tx.cartItem.findMany({ where: { userId } }),
    )
    if (items.length === 0) {
      throw new NotFoundException('cart is empty')
    }
    const orderInput: { items: { productId: number; quantity: number }[]; couponCode?: string } = {
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    }
    if (couponCode !== undefined && couponCode.length > 0) {
      orderInput.couponCode = couponCode
    }
    const order = await this.orders.create(tenantId, userId, orderInput)
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.cartItem.deleteMany({ where: { userId } }),
    )
    return order
  }
}
