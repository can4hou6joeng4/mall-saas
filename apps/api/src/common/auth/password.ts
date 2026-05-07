import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCHEME = 'scrypt'
const SALT_BYTES = 16
const KEY_BYTES = 64

export function hashPassword(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('password must be a non-empty string')
  }
  const salt = randomBytes(SALT_BYTES)
  const hash = scryptSync(plain, salt, KEY_BYTES)
  return `${SCHEME}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== SCHEME) return false
  const saltB64 = parts[1]!
  const hashB64 = parts[2]!
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  if (expected.length !== KEY_BYTES) return false
  const actual = scryptSync(plain, salt, KEY_BYTES)
  return timingSafeEqual(actual, expected)
}
