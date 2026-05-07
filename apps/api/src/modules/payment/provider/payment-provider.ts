import type { TenantId } from '@mall/shared'

export interface CreateChargeInput {
  tenantId: TenantId
  orderId: number
  paymentId: number
  amountCents: number
}

export interface CreateChargeResult {
  providerRef: string
}

export type PaymentEventStatus = 'succeeded' | 'failed'

export interface ParsedWebhook {
  providerRef: string
  status: PaymentEventStatus
}

export interface VerifyWebhookInput {
  headers: Record<string, string | string[] | undefined>
  rawBody: string
}

export interface PaymentProvider {
  readonly name: string
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>
  verifyWebhook(input: VerifyWebhookInput): ParsedWebhook
}
