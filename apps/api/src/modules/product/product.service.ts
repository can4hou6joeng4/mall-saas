import { Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import type {
  CreateProductDto,
  ListProductsQuery,
  UpdateProductDto,
} from './product.dto.js'

function buildProductUpdateData(dto: UpdateProductDto): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {}
  if (dto.name !== undefined) data.name = dto.name
  if (dto.priceCents !== undefined) data.priceCents = dto.priceCents
  if (dto.stock !== undefined) data.stock = dto.stock
  if (dto.categoryId !== undefined) data.categoryId = dto.categoryId
  return data
}

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: TenantId, dto: CreateProductDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.product.create({
        data: {
          tenantId,
          name: dto.name,
          priceCents: dto.priceCents,
          stock: dto.stock,
          categoryId: dto.categoryId ?? null,
        },
      }),
    )
  }

  list(tenantId: TenantId, query: ListProductsQuery) {
    const { page, pageSize } = query
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.product.findMany({
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.product.count(),
      ])
      return { items, total, page, pageSize }
    })
  }

  async findById(tenantId: TenantId, id: number) {
    const product = await this.prisma.withTenant(tenantId, (tx) =>
      tx.product.findUnique({ where: { id } }),
    )
    if (!product) {
      throw new NotFoundException(`product ${id} not found`)
    }
    return product
  }

  update(tenantId: TenantId, id: number, dto: UpdateProductDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } })
      if (!existing) {
        throw new NotFoundException(`product ${id} not found`)
      }
      return tx.product.update({ where: { id }, data: buildProductUpdateData(dto) })
    })
  }

  remove(tenantId: TenantId, id: number) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } })
      if (!existing) {
        throw new NotFoundException(`product ${id} not found`)
      }
      await tx.product.delete({ where: { id } })
    })
  }
}
