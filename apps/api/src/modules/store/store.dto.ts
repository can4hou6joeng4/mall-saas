import { z } from 'zod'

export const listStoreOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).optional(),
  userId: z.coerce.number().int().positive().optional(),
})
export type ListStoreOrdersQuery = z.infer<typeof listStoreOrdersQuerySchema>
