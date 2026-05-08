import { Injectable, NotFoundException } from '@nestjs/common'
import type { PaymentProvider } from './payment-provider.js'
import { MockPaymentProvider } from './mock-payment-provider.js'
import { StripePaymentProvider } from './stripe-payment-provider.js'

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: ReadonlyMap<string, PaymentProvider>

  constructor(mock: MockPaymentProvider, stripe: StripePaymentProvider) {
    const all: PaymentProvider[] = [mock, stripe]
    this.providers = new Map(all.map((p) => [p.name, p]))
  }

  get(name: string): PaymentProvider {
    const p = this.providers.get(name)
    if (!p) throw new NotFoundException(`unknown payment provider: ${name}`)
    return p
  }
}
