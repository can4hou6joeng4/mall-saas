import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type {
  CreateChargeInput,
  CreateChargeResult,
  ParsedWebhook,
  PaymentProvider,
  VerifyWebhookInput,
} from './payment-provider.js'

const HEADER = 'x-mock-signature'

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock'

  private get secret(): string {
    const s = process.env['PAYMENT_MOCK_SECRET']
    if (!s) throw new Error('PAYMENT_MOCK_SECRET is required for mock provider')
    return s
  }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    // 真实 provider 会调用远端 HTTP；mock 直接生成一个不可猜测引用，并把 paymentId 揉进去便于回调对账
    const ref = `mock_${input.paymentId}_${randomUUID()}`
    return Promise.resolve({ providerRef: ref })
  }

  // 静态工具：测试与冒烟脚本据此构造合法 webhook 签名
  signWebhookBody(body: string): string {
    return sign(this.secret, body)
  }

  verifyWebhook(input: VerifyWebhookInput): ParsedWebhook {
    const raw = input.headers[HEADER]
    const provided = Array.isArray(raw) ? raw[0] : raw
    if (typeof provided !== 'string') {
      throw new UnauthorizedException(`missing ${HEADER}`)
    }
    const expected = sign(this.secret, input.rawBody)
    const a = Buffer.from(provided, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid webhook signature')
    }
    let parsed: { providerRef?: unknown; status?: unknown }
    try {
      parsed = JSON.parse(input.rawBody) as { providerRef?: unknown; status?: unknown }
    } catch {
      throw new UnauthorizedException('webhook body is not valid JSON')
    }
    if (typeof parsed.providerRef !== 'string' || parsed.providerRef.length === 0) {
      throw new UnauthorizedException('webhook missing providerRef')
    }
    if (parsed.status !== 'succeeded' && parsed.status !== 'failed') {
      throw new UnauthorizedException('webhook status must be succeeded|failed')
    }
    return { providerRef: parsed.providerRef, status: parsed.status }
  }
}
