import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  DATABASE_APP_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 分钟
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 3600),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ORDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  PAYMENT_MOCK_SECRET: z.string().min(16),
  STRIPE_API_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_HOST: z.string().optional(),
  STRIPE_API_PORT: z.coerce.number().int().positive().optional(),
  STRIPE_API_PROTOCOL: z.enum(['http', 'https']).optional(),
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).optional(),
})

export type Env = z.infer<typeof envSchema>
