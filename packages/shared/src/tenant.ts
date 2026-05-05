declare const tenantBrand: unique symbol
export type TenantId = number & { readonly [tenantBrand]: 'TenantId' }

export function isValidTenantId(value: unknown): value is TenantId {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0
  )
}
