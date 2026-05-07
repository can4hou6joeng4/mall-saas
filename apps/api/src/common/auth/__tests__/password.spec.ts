import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../password.js'

describe('password hashing', () => {
  it('hash is non-empty and not equal to plaintext', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(hash).not.toBe('correct horse battery staple')
    expect(hash.startsWith('scrypt$')).toBe(true)
  })

  it('verify returns true for correct password', () => {
    const hash = hashPassword('s3cret-pw')
    expect(verifyPassword('s3cret-pw', hash)).toBe(true)
  })

  it('verify returns false for wrong password', () => {
    const hash = hashPassword('s3cret-pw')
    expect(verifyPassword('s3cret-pwX', hash)).toBe(false)
  })

  it('two hashes of same password differ (random salt)', () => {
    expect(hashPassword('abc12345')).not.toBe(hashPassword('abc12345'))
  })

  it('verify returns false for malformed stored hash', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false)
    expect(verifyPassword('x', 'bcrypt$abc$def')).toBe(false)
  })

  it('throws when hashing empty password', () => {
    expect(() => hashPassword('')).toThrow()
  })
})
