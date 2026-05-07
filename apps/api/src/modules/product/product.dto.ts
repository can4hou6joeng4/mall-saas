import { z } from 'zod'

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
  categoryId: z.number().int().positive().optional().nullable(),
})

export type CreateProductDto = z.infer<typeof createProductSchema>

export const updateProductSchema = createProductSchema.partial()
export type UpdateProductDto = z.infer<typeof updateProductSchema>

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>
