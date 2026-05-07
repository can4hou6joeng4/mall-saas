import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { TenantId } from '@mall/shared'
import { PrismaService } from '../../common/prisma/prisma.service.js'
import { OrderService, ORDER_STATUS } from '../order/order.service.js'
import { PaymentProviderRegistry } from './provider/payment-provider.registry.js'
import type { ParsedWebhook } from './provider/payment-provider.js'

export const PAYMENT_STATUS = {
  pending: 'pending',
  succeeded: 'succeeded',
  failed: 'failed',
} as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly orders: OrderService,
  ) {}

  async pay(
    tenantId: TenantId,
    userId: number,
    orderId: number,
    providerName: string,
  ) {
    const provider = this.registry.get(providerName)

    const draft = await this.prisma.withTenant(tenantId, async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order || order.userId !== userId) {
        throw new NotFoundException(`order ${orderId} not found`)
      }
      if (order.status !== ORDER_STATUS.pending) {
        throw new ConflictException(
          `order ${orderId} cannot be paid in status ${order.status}`,
        )
      }
      // 占位 providerRef，后续 update 写入真实值
      return tx.payment.create({
        data: {
          tenantId,
          orderId: order.id,
          providerName: provider.name,
          providerRef: `pending_${orderId}_${Date.now()}`,
          amountCents: order.totalCents,
          status: PAYMENT_STATUS.pending,
        },
      })
    })

    const charge = await provider.createCharge({
      tenantId,
      orderId,
      paymentId: draft.id,
      amountCents: draft.amountCents,
    })

    return this.prisma.withTenant(tenantId, (tx) =>
      tx.payment.update({
        where: { id: draft.id },
        data: { providerRef: charge.providerRef },
      }),
    )
  }

  async handleWebhook(
    providerName: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<{ acknowledged: true }> {
    const provider = this.registry.get(providerName)
    const event: ParsedWebhook = provider.verifyWebhook({ headers, rawBody })

    const sys = this.prisma.getSuperuserClient()
    const payment = await sys.payment.findUnique({
      where: {
        providerName_providerRef: {
          providerName: provider.name,
          providerRef: event.providerRef,
        },
      },
    })
    if (!payment) {
      throw new NotFoundException(`payment for ${provider.name}/${event.providerRef} not found`)
    }
    if (payment.status !== PAYMENT_STATUS.pending) {
      this.logger.log(
        { paymentId: payment.id, status: payment.status },
        'webhook re-delivery, payment already finalized — acknowledging',
      )
      return { acknowledged: true }
    }

    const tenantId = payment.tenantId as TenantId
    if (event.status === 'succeeded') {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PAYMENT_STATUS.succeeded },
        })
        const order = await tx.order.findUnique({ where: { id: payment.orderId } })
        if (order?.status === ORDER_STATUS.pending) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: ORDER_STATUS.paid },
          })
        }
      })
    } else {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.payment.update({
          where: { id: payment.id },
          data: { status: PAYMENT_STATUS.failed },
        }),
      )
      // 失败：把订单回到 cancelled 并恢复库存（idempotent，非 pending 自动跳过）
      await this.orders.cancelIfPending(tenantId, payment.orderId)
    }
    return { acknowledged: true }
  }
}
