import { Injectable, UnauthorizedException } from '@nestjs/common'
import Stripe from 'stripe'
import type {
  CreateChargeInput,
  CreateChargeResult,
  ParsedWebhook,
  PaymentProvider,
  VerifyWebhookInput,
} from './payment-provider.js'

const HEADER = 'stripe-signature'

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe'

  // 懒构造：测试和未配置 STRIPE_API_KEY 时不应报错
  private clientCache: Stripe | undefined

  private get apiKey(): string {
    const key = process.env['STRIPE_API_KEY']
    if (!key) throw new Error('STRIPE_API_KEY is required for stripe provider')
    return key
  }

  private get webhookSecret(): string {
    const s = process.env['STRIPE_WEBHOOK_SECRET']
    if (!s) throw new Error('STRIPE_WEBHOOK_SECRET is required for stripe provider')
    return s
  }

  // 测试场景注入；运行时不传则用真实 stripe SDK
  client(): Stripe {
    if (!this.clientCache) {
      type StripeOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>
      // 不在代码里写死 apiVersion，让 SDK 用其默认；测试场景注入 host 走 stripe-mock
      const opts: StripeOptions = {} as StripeOptions
      const host = process.env['STRIPE_API_HOST']
      if (host) {
        opts.host = host
        opts.protocol = process.env['STRIPE_API_PROTOCOL'] === 'https' ? 'https' : 'http'
        const portStr = process.env['STRIPE_API_PORT']
        if (portStr) opts.port = Number(portStr)
      }
      this.clientCache = new Stripe(this.apiKey, opts)
    }
    return this.clientCache
  }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const intent = await this.client().paymentIntents.create({
      amount: input.amountCents,
      currency: 'usd',
      // 关联回业务订单 / 租户（webhook 回来时用来快速定位）
      metadata: {
        tenantId: String(input.tenantId),
        orderId: String(input.orderId),
        paymentId: String(input.paymentId),
      },
      // 关闭 webhook 之外的副作用
      capture_method: 'automatic',
    })
    return { providerRef: intent.id }
  }

  verifyWebhook(input: VerifyWebhookInput): ParsedWebhook {
    const raw = input.headers[HEADER]
    const sigHeader = Array.isArray(raw) ? raw[0] : raw
    if (typeof sigHeader !== 'string') {
      throw new UnauthorizedException(`missing ${HEADER}`)
    }
    let event: Stripe.Event
    try {
      event = this.client().webhooks.constructEvent(
        input.rawBody,
        sigHeader,
        this.webhookSecret,
      )
    } catch (err) {
      throw new UnauthorizedException(
        `stripe webhook verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    return mapEventToWebhook(event)
  }
}

function mapEventToWebhook(event: Stripe.Event): ParsedWebhook {
  const isSucceeded = event.type === 'payment_intent.succeeded'
  const isFailed =
    event.type === 'payment_intent.payment_failed' ||
    event.type === 'payment_intent.canceled'
  if (!isSucceeded && !isFailed) {
    throw new UnauthorizedException(`unsupported stripe event type: ${event.type}`)
  }
  const obj = event.data.object as { id?: unknown }
  if (typeof obj.id !== 'string') {
    throw new UnauthorizedException('stripe event missing payment_intent id')
  }
  return {
    providerRef: obj.id,
    status: isSucceeded ? 'succeeded' : 'failed',
  }
}
