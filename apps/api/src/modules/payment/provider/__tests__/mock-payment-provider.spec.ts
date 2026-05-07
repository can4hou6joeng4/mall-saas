import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { MockPaymentProvider } from '../mock-payment-provider.js'

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider
  const prevSecret = process.env['PAYMENT_MOCK_SECRET']

  beforeAll(() => {
    process.env['PAYMENT_MOCK_SECRET'] = 'unit-test-shared-secret'
    provider = new MockPaymentProvider()
  })

  afterAll(() => {
    if (prevSecret === undefined) delete process.env['PAYMENT_MOCK_SECRET']
    else process.env['PAYMENT_MOCK_SECRET'] = prevSecret
  })

  it('createCharge returns a deterministic-prefix providerRef', async () => {
    const result = await provider.createCharge({
      tenantId: 1 as never,
      orderId: 7,
      paymentId: 99,
      amountCents: 100,
    })
    expect(result.providerRef).toMatch(/^mock_99_/)
  })

  it('verifyWebhook accepts a properly signed payload', () => {
    const body = JSON.stringify({ providerRef: 'mock_1_abc', status: 'succeeded' })
    const signature = provider.signWebhookBody(body)
    const parsed = provider.verifyWebhook({
      headers: { 'x-mock-signature': signature },
      rawBody: body,
    })
    expect(parsed).toEqual({ providerRef: 'mock_1_abc', status: 'succeeded' })
  })

  it('verifyWebhook rejects missing signature', () => {
    expect(() =>
      provider.verifyWebhook({ headers: {}, rawBody: '{}' }),
    ).toThrow(UnauthorizedException)
  })

  it('verifyWebhook rejects bad signature', () => {
    const body = JSON.stringify({ providerRef: 'x', status: 'succeeded' })
    expect(() =>
      provider.verifyWebhook({
        headers: { 'x-mock-signature': 'deadbeef'.repeat(8) },
        rawBody: body,
      }),
    ).toThrow(UnauthorizedException)
  })

  it('verifyWebhook rejects malformed JSON', () => {
    const body = 'not json'
    const signature = provider.signWebhookBody(body)
    expect(() =>
      provider.verifyWebhook({
        headers: { 'x-mock-signature': signature },
        rawBody: body,
      }),
    ).toThrow(UnauthorizedException)
  })

  it('verifyWebhook rejects unknown status', () => {
    const body = JSON.stringify({ providerRef: 'x', status: 'lulz' })
    const signature = provider.signWebhookBody(body)
    expect(() =>
      provider.verifyWebhook({
        headers: { 'x-mock-signature': signature },
        rawBody: body,
      }),
    ).toThrow(UnauthorizedException)
  })
})
