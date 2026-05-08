import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import {
  STORAGE_PROVIDER,
} from '../../common/storage/storage.module.js'
import type { StorageProvider } from '../../common/storage/storage-provider.js'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 5 * 1024 * 1024

@Injectable()
export class ProductImageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async upload(
    tenantId: TenantId,
    productId: number,
    file: { buffer: Buffer; filename: string; contentType: string },
  ) {
    if (!ALLOWED.has(file.contentType)) {
      throw new ConflictException(`unsupported content type ${file.contentType}`)
    }
    if (file.buffer.byteLength > MAX_BYTES) {
      throw new ConflictException(`file too large (max ${MAX_BYTES} bytes)`)
    }

    // 校验 product 存在并属于本租户
    const product = await this.prisma.withTenant(tenantId, (tx) =>
      tx.product.findUnique({ where: { id: productId } }),
    )
    if (!product) throw new NotFoundException(`product ${productId} not found`)

    // 写文件到 storage（外部副作用）
    const stored = await this.storage.put({
      tenantId,
      contentType: file.contentType,
      buffer: file.buffer,
      filename: file.filename,
    })

    // 写数据库（如果 DB 写失败，本地已落盘的文件作为孤儿留存；后续 GC 任务清理。生产建议放预签名+客户端直传）
    return this.prisma.withTenant(tenantId, async (tx) => {
      const next = await tx.productImage.aggregate({
        where: { productId },
        _max: { position: true },
      })
      const position = (next._max.position ?? -1) + 1
      return tx.productImage.create({
        data: {
          tenantId,
          productId,
          storageKey: stored.storageKey,
          url: stored.publicUrl,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
          position,
        },
      })
    })
  }

  list(tenantId: TenantId, productId: number) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.productImage.findMany({
        where: { productId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    )
  }

  async remove(tenantId: TenantId, imageId: number): Promise<void> {
    const image = await this.prisma.withTenant(tenantId, (tx) =>
      tx.productImage.findUnique({ where: { id: imageId } }),
    )
    if (!image) throw new NotFoundException(`image ${imageId} not found`)

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.productImage.delete({ where: { id: imageId } }),
    )
    // 数据库已删除，再清磁盘文件（失败仅 log；不影响业务）
    try {
      await this.storage.delete(image.storageKey)
    } catch {
      // ignore: 孤儿文件由后续清理任务处理
    }
  }
}
