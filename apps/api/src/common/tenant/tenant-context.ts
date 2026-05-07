import { AsyncLocalStorage } from 'node:async_hooks'
import type { TenantId } from '@mall/shared'

export interface RequestContext {
  readonly tenantId: TenantId
  readonly userId: number
  readonly email: string
  readonly role: string
  readonly traceId?: string
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export function getCurrentRequestContext(): RequestContext {
  const ctx = requestContextStorage.getStore()
  if (!ctx) {
    throw new Error('RequestContext is not active for this request')
  }
  return ctx
}

export function tryGetCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore()
}
