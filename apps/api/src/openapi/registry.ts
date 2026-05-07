import './extend-zod.js'
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  loginSchema as authLoginSchema,
  registerSchema as authRegisterSchema,
} from '../modules/auth/auth.dto.js'
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '../modules/product/product.dto.js'
import {
  createOrderSchema,
  listOrdersQuerySchema,
} from '../modules/order/order.dto.js'
import { payOrderSchema } from '../modules/payment/payment.dto.js'
import {
  adminLoginSchema,
  createTenantSchema,
  listOrdersAdminQuerySchema,
  listPaymentsAdminQuerySchema,
  updateTenantSchema,
} from '../modules/admin/admin.dto.js'

export const registry = new OpenAPIRegistry()

// 安全方案：tenant 与 platform 都用 Bearer JWT，只是 scope 不同
export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})

// 通用错误响应
const errorResponseSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  })
  .openapi('ErrorResponse')
registry.register('ErrorResponse', errorResponseSchema)

// Auth
const registerInput = authRegisterSchema.openapi('RegisterRequest')
const loginInput = authLoginSchema.openapi('LoginRequest')
const authResultSchema = z
  .object({
    accessToken: z.string(),
    user: z.object({
      id: z.number().int(),
      tenantId: z.number().int(),
      email: z.string().email(),
      role: z.string(),
    }),
  })
  .openapi('AuthResult')
registry.register('RegisterRequest', registerInput)
registry.register('LoginRequest', loginInput)
registry.register('AuthResult', authResultSchema)

// Product
const productSchema = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int(),
    categoryId: z.number().int().nullable(),
    name: z.string(),
    priceCents: z.number().int(),
    stock: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Product')
const productListSchema = z
  .object({
    items: z.array(productSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('ProductList')
registry.register('Product', productSchema)
registry.register('ProductList', productListSchema)
registry.register('CreateProductRequest', createProductSchema.openapi('CreateProductRequest'))
registry.register('UpdateProductRequest', updateProductSchema.openapi('UpdateProductRequest'))
registry.register(
  'ListProductsQuery',
  listProductsQuerySchema.openapi('ListProductsQuery'),
)

// Order
const orderItemSchema = z
  .object({
    id: z.number().int(),
    orderId: z.number().int(),
    productId: z.number().int(),
    quantity: z.number().int(),
    unitPriceCents: z.number().int(),
    subtotalCents: z.number().int(),
  })
  .openapi('OrderItem')
const orderSchema = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int(),
    userId: z.number().int(),
    status: z.enum(['pending', 'paid', 'cancelled']),
    totalCents: z.number().int(),
    items: z.array(orderItemSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Order')
registry.register('OrderItem', orderItemSchema)
registry.register('Order', orderSchema)
registry.register('CreateOrderRequest', createOrderSchema.openapi('CreateOrderRequest'))
registry.register('ListOrdersQuery', listOrdersQuerySchema.openapi('ListOrdersQuery'))

// Payment
const paymentSchema = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int(),
    orderId: z.number().int(),
    providerName: z.string(),
    providerRef: z.string(),
    amountCents: z.number().int(),
    status: z.enum(['pending', 'succeeded', 'failed']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Payment')
registry.register('Payment', paymentSchema)
registry.register('PayOrderRequest', payOrderSchema.openapi('PayOrderRequest'))

// Admin
const tenantSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    createdAt: z.string().datetime(),
  })
  .openapi('Tenant')
registry.register('Tenant', tenantSchema)
registry.register('AdminLoginRequest', adminLoginSchema.openapi('AdminLoginRequest'))
registry.register('CreateTenantRequest', createTenantSchema.openapi('CreateTenantRequest'))
registry.register('UpdateTenantRequest', updateTenantSchema.openapi('UpdateTenantRequest'))
registry.register(
  'AdminListOrdersQuery',
  listOrdersAdminQuerySchema.openapi('AdminListOrdersQuery'),
)
registry.register(
  'AdminListPaymentsQuery',
  listPaymentsAdminQuerySchema.openapi('AdminListPaymentsQuery'),
)

export const schemaRefs = {
  errorResponse: errorResponseSchema,
  authResult: authResultSchema,
  product: productSchema,
  productList: productListSchema,
  order: orderSchema,
  payment: paymentSchema,
  tenant: tenantSchema,
}
