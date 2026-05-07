import { z } from 'zod'

export const registerSchema = z.object({
  tenantId: z.number().int().positive(),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'user']).optional(),
})

export type RegisterDto = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  tenantId: z.number().int().positive(),
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
})

export type LoginDto = z.infer<typeof loginSchema>
