import { z } from 'zod'

export const payOrderSchema = z.object({
  provider: z.enum(['mock']).default('mock'),
})

export type PayOrderDto = z.infer<typeof payOrderSchema>
