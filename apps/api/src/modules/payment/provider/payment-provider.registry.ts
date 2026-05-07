import { Injectable, NotFoundException } from '@nestjs/common'
import type { PaymentProvider } from './payment-provider.js'
import { MockPaymentProvider } from './mock-payment-provider.js'

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: ReadonlyMap<string, PaymentProvider>

  constructor(mock: MockPaymentProvider) {
    const all: PaymentProvider[] = [mock]
    this.providers = new Map(all.map((p) => [p.name, p]))
  }

  get(name: string): PaymentProvider {
    const p = this.providers.get(name)
    if (!p) throw new NotFoundException(`unknown payment provider: ${name}`)
    return p
  }
}
