import { describe, expect, it } from 'vitest'
import { TenantId, isValidTenantId } from '../tenant.js'

describe('TenantId', () => {
  it('TenantId 是 number 的 nominal 类型别名', () => {
    const id: TenantId = 42 as TenantId
    expect(typeof id).toBe('number')
  })

  it('isValidTenantId 接受正整数', () => {
    expect(isValidTenantId(1)).toBe(true)
    expect(isValidTenantId(42)).toBe(true)
  })

  it('isValidTenantId 拒绝零、负数、非整数与非数字', () => {
    expect(isValidTenantId(0)).toBe(false)
    expect(isValidTenantId(-1)).toBe(false)
    expect(isValidTenantId(1.5)).toBe(false)
    expect(isValidTenantId('1' as unknown as number)).toBe(false)
    expect(isValidTenantId(NaN)).toBe(false)
  })
})
