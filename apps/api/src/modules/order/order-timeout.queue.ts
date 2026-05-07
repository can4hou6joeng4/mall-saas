import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import type { TenantId } from '@mall/shared'

export interface OrderTimeoutPayload {
  tenantId: number
  orderId: number
}

export const ORDER_TIMEOUT_QUEUE = 'order-timeout'
export const ORDER_TIMEOUT_MS_TOKEN = 'ORDER_TIMEOUT_MS'

// 通过 ModuleRef 延迟解析 OrderService，避免与之产生构造期循环依赖
interface OrderCancellationCapable {
  cancelIfPending(tenantId: TenantId, orderId: number): Promise<boolean>
}

@Injectable()
export class OrderTimeoutQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderTimeoutQueue.name)
  private connection!: Redis
  private workerConnection!: Redis
  private queue!: Queue<OrderTimeoutPayload>
  private worker?: Worker<OrderTimeoutPayload>
  private orders!: OrderCancellationCapable

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(ORDER_TIMEOUT_MS_TOKEN) private readonly defaultTimeoutMs: number,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env['REDIS_URL']
    if (!url) throw new Error('REDIS_URL is required')

    const { OrderService } = await import('./order.service.js')
    this.orders = this.moduleRef.get(OrderService, { strict: false })

    this.connection = new Redis(url, { maxRetriesPerRequest: null })
    this.workerConnection = new Redis(url, { maxRetriesPerRequest: null })
    this.queue = new Queue<OrderTimeoutPayload>(ORDER_TIMEOUT_QUEUE, {
      connection: this.connection,
    })
    this.worker = new Worker<OrderTimeoutPayload>(
      ORDER_TIMEOUT_QUEUE,
      async (job) => this.process(job.data),
      { connection: this.workerConnection },
    )
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err: err.message }, 'order-timeout job failed')
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
    await this.queue?.close()
    this.connection?.disconnect()
    this.workerConnection?.disconnect()
  }

  enqueue(payload: OrderTimeoutPayload, delayMs?: number): Promise<unknown> {
    const delay = delayMs ?? this.defaultTimeoutMs
    return this.queue.add('timeout', payload, {
      delay,
      removeOnComplete: 100,
      removeOnFail: 100,
    })
  }

  async process(payload: OrderTimeoutPayload): Promise<boolean> {
    const cancelled = await this.orders.cancelIfPending(
      payload.tenantId as TenantId,
      payload.orderId,
    )
    if (cancelled) {
      this.logger.log({ orderId: payload.orderId }, 'order auto-cancelled by timeout')
    }
    return cancelled
  }
}
