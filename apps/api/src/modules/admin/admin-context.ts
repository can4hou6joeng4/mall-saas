import { AsyncLocalStorage } from 'node:async_hooks'

export interface PlatformAdminContext {
  readonly adminId: number
  readonly email: string
}

export const platformAdminStorage = new AsyncLocalStorage<PlatformAdminContext>()

export function getCurrentPlatformAdmin(): PlatformAdminContext {
  const ctx = platformAdminStorage.getStore()
  if (!ctx) {
    throw new Error('PlatformAdminContext is not active for this request')
  }
  return ctx
}
