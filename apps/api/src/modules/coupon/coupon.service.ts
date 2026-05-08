import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import type { CreateCouponDto, ListCouponsQuery } from './coupon.dto.js'

export const COUPON_DISCOUNT = {
  percent: 'PERCENT',
  amount: 'AMOUNT',
} as const

export interface AppliedCoupon {
  couponId: number
  discountCents: number
}

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: TenantId, dto: CreateCouponDto) {
    return this.prisma
      .withTenant(tenantId, async (tx) => {
        const data: Parameters<typeof tx.coupon.create>[0]['data'] = {
          tenantId,
          code: dto.code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minOrderCents: dto.minOrderCents,
          maxUsage: dto.maxUsage,
        }
        if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt)
        return tx.coupon.create({ data })
      })
      .catch((err: unknown) => {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: unknown }).code === 'P2002'
        ) {
          throw new ConflictException(`coupon code "${dto.code}" already exists`)
        }
        throw err
      })
  }

  list(tenantId: TenantId, query: ListCouponsQuery) {
    const { page, pageSize, status } = query
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where: { status?: string } = {}
      if (status) where.status = status
      const [items, total] = await Promise.all([
        tx.coupon.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.coupon.count({ where }),
      ])
      return { items, total, page, pageSize }
    })
  }

  async disable(tenantId: TenantId, id: number) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.coupon.findUnique({ where: { id } })
      if (!existing) throw new NotFoundException(`coupon ${id} not found`)
      return tx.coupon.update({ where: { id }, data: { status: 'disabled' } })
    })
  }

  // 给 OrderService 用：在事务内校验+应用，返回折扣信息（不在这里做金额扣减）
  // 调用方必须在同一事务内增加 usageCount 并把 couponId 关联到 order。
  static computeDiscountCents(
    coupon: {
      discountType: string
      discountValue: number
      minOrderCents: number
      maxUsage: number
      usageCount: number
      expiresAt: Date | null
      status: string
    },
    subtotalCents: number,
    now: Date = new Date(),
  ): { discountCents: number } {
    if (coupon.status !== 'active') {
      throw new ConflictException('coupon is not active')
    }
    if (coupon.expiresAt && coupon.expiresAt.getTime() < now.getTime()) {
      throw new ConflictException('coupon has expired')
    }
    if (coupon.maxUsage > 0 && coupon.usageCount >= coupon.maxUsage) {
      throw new ConflictException('coupon usage limit reached')
    }
    if (subtotalCents < coupon.minOrderCents) {
      throw new ConflictException(
        `coupon requires minimum subtotal ${coupon.minOrderCents} cents`,
      )
    }
    let discount = 0
    if (coupon.discountType === COUPON_DISCOUNT.percent) {
      discount = Math.floor((subtotalCents * coupon.discountValue) / 100)
    } else if (coupon.discountType === COUPON_DISCOUNT.amount) {
      discount = coupon.discountValue
    } else {
      throw new ConflictException(`unknown discount type ${coupon.discountType}`)
    }
    if (discount > subtotalCents) discount = subtotalCents
    return { discountCents: discount }
  }
}
