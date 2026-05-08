import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from 'vitest'
import Stripe from 'stripe'
import { UnauthorizedException } from '@nestjs/common'
import { StripePaymentProvider } from '../stripe-payment-provider.js'

describe('StripePaymentProvider', () => {
  let provider: StripePaymentProvider
  const prevKey = process.env['STRIPE_API_KEY']
  const prevSecret = process.env['STRIPE_WEBHOOK_SECRET']

  beforeAll(() => {
    process.env['STRIPE_API_KEY'] = 'sk_test_unit'
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_unit_secret'
    provider = new StripePaymentProvider()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    if (prevKey === undefined) delete process.env['STRIPE_API_KEY']
    else process.env['STRIPE_API_KEY'] = prevKey
    if (prevSecret === undefined) delete process.env['STRIPE_WEBHOOK_SECRET']
    else process.env['STRIPE_WEBHOOK_SECRET'] = prevSecret
  })

  it('createCharge calls paymentIntents.create with amount + metadata, returns intent.id', async () => {
    const fakeIntent = { id: 'pi_test_123', client_secret: 'cs_test' } as Stripe.PaymentIntent
    const create = vi.fn().mockResolvedValue(fakeIntent)
    vi
      .spyOn(provider, 'client')
      .mockReturnValue({ paymentIntents: { create } } as unknown as Stripe)

    const result = await provider.createCharge({
      tenantId: 7 as never,
      orderId: 42,
      paymentId: 1234,
      amountCents: 9900,
    })
    expect(result.providerRef).toBe('pi_test_123')
    expect(create).toHaveBeenCalledOnce()
    const call = create.mock.calls[0]?.[0] as Stripe.PaymentIntentCreateParams
    expect(call.amount).toBe(9900)
    expect(call.currency).toBe('usd')
    expect(call.metadata).toMatchObject({
      tenantId: '7',
      orderId: '42',
      paymentId: '1234',
    })
  })

  it('verifyWebhook accepts a properly signed payment_intent.succeeded event', () => {
    const stripe = new Stripe('sk_test_unit')
    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_OK' } },
    })
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_unit_secret',
    })

    const parsed = provider.verifyWebhook({
      headers: { 'stripe-signature': signature },
      rawBody: payload,
    })
    expect(parsed).toEqual({ providerRef: 'pi_test_OK', status: 'succeeded' })
  })

  it('verifyWebhook maps payment_intent.payment_failed to failed', () => {
    const stripe = new Stripe('sk_test_unit')
    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_test_FAIL' } },
    })
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_unit_secret',
    })
    const parsed = provider.verifyWebhook({
      headers: { 'stripe-signature': signature },
      rawBody: payload,
    })
    expect(parsed).toEqual({ providerRef: 'pi_test_FAIL', status: 'failed' })
  })

  it('verifyWebhook rejects missing signature header', () => {
    expect(() =>
      provider.verifyWebhook({ headers: {}, rawBody: '{}' }),
    ).toThrow(UnauthorizedException)
  })

  it('verifyWebhook rejects bad signature', () => {
    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_x' } },
    })
    expect(() =>
      provider.verifyWebhook({
        headers: { 'stripe-signature': 't=1,v1=deadbeef' },
        rawBody: payload,
      }),
    ).toThrow(UnauthorizedException)
  })

  it('verifyWebhook rejects unsupported event type', () => {
    const stripe = new Stripe('sk_test_unit')
    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'invoice.paid',
      data: { object: { id: 'in_x' } },
    })
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_unit_secret',
    })
    expect(() =>
      provider.verifyWebhook({
        headers: { 'stripe-signature': signature },
        rawBody: payload,
      }),
    ).toThrow(UnauthorizedException)
  })
})
