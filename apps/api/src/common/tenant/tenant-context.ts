import { AsyncLocalStorage } from 'node:async_hooks'
import type { TenantId } from '@mall/shared'

export interface TenantContext {
  readonly tenantId: TenantId
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>()

export function getCurrentTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore()
  if (!ctx) {
    throw new Error('TenantContext is not active for this request')
  }
  return ctx
}
