import { z } from 'zod'

export const createCouponSchema = z
  .object({
    code: z.string().min(1).max(64),
    discountType: z.enum(['PERCENT', 'AMOUNT']),
    discountValue: z.number().int().positive(),
    minOrderCents: z.number().int().nonnegative().default(0),
    maxUsage: z.number().int().nonnegative().default(0),
    expiresAt: z.string().datetime().optional(),
  })
  .refine(
    (v) => v.discountType !== 'PERCENT' || v.discountValue <= 100,
    { message: 'PERCENT discountValue must be 1..100', path: ['discountValue'] },
  )

export type CreateCouponDto = z.infer<typeof createCouponSchema>

export const listCouponsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['active', 'disabled']).optional(),
})
export type ListCouponsQuery = z.infer<typeof listCouponsQuerySchema>
