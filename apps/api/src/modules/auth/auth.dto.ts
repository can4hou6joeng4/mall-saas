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

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})
export type RefreshDto = z.infer<typeof refreshSchema>

export const requestPasswordResetSchema = z.object({
  tenantId: z.number().int().positive(),
  email: z.string().email().max(200),
})
export type RequestPasswordResetDto = z.infer<typeof requestPasswordResetSchema>

export const confirmPasswordResetSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})
export type ConfirmPasswordResetDto = z.infer<typeof confirmPasswordResetSchema>
