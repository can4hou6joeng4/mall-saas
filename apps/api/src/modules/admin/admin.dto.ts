import { z } from 'zod'

export const adminLoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
})
export type AdminLoginDto = z.infer<typeof adminLoginSchema>

export const createTenantSchema = z.object({
  name: z.string().min(1).max(200),
})
export type CreateTenantDto = z.infer<typeof createTenantSchema>

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(200),
})
export type UpdateTenantDto = z.infer<typeof updateTenantSchema>

export const listOrdersAdminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  tenantId: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'paid', 'cancelled']).optional(),
})
export type ListOrdersAdminQuery = z.infer<typeof listOrdersAdminQuerySchema>

export const listPaymentsAdminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  tenantId: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'succeeded', 'failed']).optional(),
})
export type ListPaymentsAdminQuery = z.infer<typeof listPaymentsAdminQuerySchema>
