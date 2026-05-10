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

// `default({})` 让 controller 收到 undefined body 时（向后兼容 M19 不传 body 的客户端）
// 也能通过 ZodValidationPipe，得到 {couponCode: undefined}
export const cartCheckoutSchema = z
  .object({
    couponCode: z.string().min(1).max(64).optional(),
  })
  .default({})
export type CartCheckoutDto = z.infer<typeof cartCheckoutSchema>
