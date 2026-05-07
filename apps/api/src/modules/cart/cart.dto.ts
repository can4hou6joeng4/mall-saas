import { z } from 'zod'

export const addCartItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(999),
})
export type AddCartItemDto = z.infer<typeof addCartItemSchema>

export const updateCartItemSchema = z.object({
  quantity: z.number().int().positive().max(999),
})
export type UpdateCartItemDto = z.infer<typeof updateCartItemSchema>
