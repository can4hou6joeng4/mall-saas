import { describe, expect, it } from 'vitest'
import { envSchema } from '../env.schema.js'

describe('envSchema', () => {
  const baseValid = {
    NODE_ENV: 'test',
    PORT: '3000',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://mall:mall@localhost:5432/mall?schema=public',
    REDIS_URL: 'redis://localhost:6379/0',
  }

  it('parses a fully valid env', () => {
    const parsed = envSchema.parse(baseValid)
    expect(parsed.PORT).toBe(3000)
  })

  it('coerces PORT to number', () => {
    const parsed = envSchema.parse({ ...baseValid, PORT: '4001' })
    expect(parsed.PORT).toBe(4001)
  })

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = baseValid
    expect(() => envSchema.parse(rest)).toThrow()
  })

  it('rejects malformed DATABASE_URL', () => {
    expect(() =>
      envSchema.parse({ ...baseValid, DATABASE_URL: 'not-a-url' }),
    ).toThrow()
  })
})
