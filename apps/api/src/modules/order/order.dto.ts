import { z } from 'zod'

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
  couponCode: z.string().min(1).max(64).optional(),
})

export type CreateOrderDto = z.infer<typeof createOrderSchema>

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).optional(),
})

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>
