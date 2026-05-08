import './extend-zod.js'
import { z } from 'zod'
import { bearerAuth, registry, schemaRefs } from './registry.js'
import {
  loginSchema,
  registerSchema,
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

const tenantSecurity = [{ [bearerAuth.name]: [] }]
const platformSecurity = [{ [bearerAuth.name]: [] }]

const errorResponses = {
  '400': {
    description: 'Bad request',
    content: { 'application/json': { schema: schemaRefs.errorResponse } },
  },
  '401': {
    description: 'Unauthorized',
    content: { 'application/json': { schema: schemaRefs.errorResponse } },
  },
  '403': {
    description: 'Forbidden',
    content: { 'application/json': { schema: schemaRefs.errorResponse } },
  },
  '404': {
    description: 'Not found',
    content: { 'application/json': { schema: schemaRefs.errorResponse } },
  },
  '409': {
    description: 'Conflict',
    content: { 'application/json': { schema: schemaRefs.errorResponse } },
  },
}

// Health
registry.registerPath({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  responses: {
    '200': {
      description: 'Liveness',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
})
registry.registerPath({
  method: 'get',
  path: '/readyz',
  tags: ['health'],
  responses: {
    '200': {
      description: 'Readiness',
      content: {
        'application/json': {
          schema: z.object({
            status: z.enum(['ok', 'fail']),
            checks: z.object({
              db: z.enum(['ok', 'fail']),
              redis: z.enum(['ok', 'fail']),
            }),
          }),
        },
      },
    },
  },
})
registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['observability'],
  responses: {
    '200': {
      description: 'Prometheus metrics text',
      content: { 'text/plain': { schema: z.string() } },
    },
  },
})

// Auth
registry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['auth'],
  request: { body: { content: { 'application/json': { schema: registerSchema } } } },
  responses: {
    '201': {
      description: 'New user registered',
      content: { 'application/json': { schema: schemaRefs.authResult } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  request: { body: { content: { 'application/json': { schema: loginSchema } } } },
  responses: {
    '200': {
      description: 'Tenant access token',
      content: { 'application/json': { schema: schemaRefs.authResult } },
    },
    ...errorResponses,
  },
})

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ refreshToken: z.string() }) },
      },
    },
  },
  responses: {
    '200': {
      description: 'Rotated token pair',
      content: { 'application/json': { schema: schemaRefs.authResult } },
    },
    ...errorResponses,
  },
})

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ refreshToken: z.string() }) },
      },
    },
  },
  responses: {
    '204': { description: 'Refresh token revoked' },
    ...errorResponses,
  },
})

registry.registerPath({
  method: 'post',
  path: '/auth/password-reset/request',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            tenantId: z.number().int().positive(),
            email: z.string().email(),
          }),
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Reset token issued (dev returns it directly; prod sends email)',
      content: {
        'application/json': {
          schema: z.object({
            resetToken: z.string(),
            expiresInSeconds: z.number().int(),
          }),
        },
      },
    },
    ...errorResponses,
  },
})

registry.registerPath({
  method: 'post',
  path: '/auth/password-reset/confirm',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            resetToken: z.string(),
            newPassword: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Password updated',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    ...errorResponses,
  },
})

// Products
registry.registerPath({
  method: 'get',
  path: '/products',
  tags: ['product'],
  security: tenantSecurity,
  request: { query: listProductsQuerySchema },
  responses: {
    '200': {
      description: 'Product list (tenant-scoped)',
      content: { 'application/json': { schema: schemaRefs.productList } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/products',
  tags: ['product'],
  security: tenantSecurity,
  request: { body: { content: { 'application/json': { schema: createProductSchema } } } },
  responses: {
    '201': {
      description: 'Product created',
      content: { 'application/json': { schema: schemaRefs.product } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/products/{id}',
  tags: ['product'],
  security: tenantSecurity,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    '200': {
      description: 'Product detail',
      content: { 'application/json': { schema: schemaRefs.product } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'put',
  path: '/products/{id}',
  tags: ['product'],
  security: tenantSecurity,
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: { content: { 'application/json': { schema: updateProductSchema } } },
  },
  responses: {
    '200': {
      description: 'Product updated',
      content: { 'application/json': { schema: schemaRefs.product } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'delete',
  path: '/products/{id}',
  tags: ['product'],
  security: tenantSecurity,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    '204': { description: 'Product deleted' },
    ...errorResponses,
  },
})

// Orders
registry.registerPath({
  method: 'post',
  path: '/orders',
  tags: ['order'],
  security: tenantSecurity,
  request: { body: { content: { 'application/json': { schema: createOrderSchema } } } },
  responses: {
    '201': {
      description: 'Order created',
      content: { 'application/json': { schema: schemaRefs.order } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/orders',
  tags: ['order'],
  security: tenantSecurity,
  request: { query: listOrdersQuerySchema },
  responses: {
    '200': {
      description: 'Order list',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(schemaRefs.order),
            total: z.number().int(),
            page: z.number().int(),
            pageSize: z.number().int(),
          }),
        },
      },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/orders/{id}',
  tags: ['order'],
  security: tenantSecurity,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    '200': {
      description: 'Order detail',
      content: { 'application/json': { schema: schemaRefs.order } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/orders/{id}/cancel',
  tags: ['order'],
  security: tenantSecurity,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    '200': {
      description: 'Order cancelled',
      content: { 'application/json': { schema: schemaRefs.order } },
    },
    ...errorResponses,
  },
})

// Payments
registry.registerPath({
  method: 'post',
  path: '/orders/{id}/pay',
  tags: ['payment'],
  security: tenantSecurity,
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: { content: { 'application/json': { schema: payOrderSchema } } },
  },
  responses: {
    '200': {
      description: 'Payment record',
      content: { 'application/json': { schema: schemaRefs.payment } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/webhooks/payments/{provider}',
  tags: ['payment'],
  request: {
    params: z.object({ provider: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            providerRef: z.string(),
            status: z.enum(['succeeded', 'failed']),
          }),
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Acknowledged',
      content: {
        'application/json': { schema: z.object({ acknowledged: z.literal(true) }) },
      },
    },
    ...errorResponses,
  },
})

// Cart
const cartItemListSchema = z.array(
  z.object({
    id: z.number().int(),
    tenantId: z.number().int(),
    userId: z.number().int(),
    productId: z.number().int(),
    quantity: z.number().int(),
  }),
)
registry.registerPath({
  method: 'get',
  path: '/cart',
  tags: ['cart'],
  security: tenantSecurity,
  responses: {
    '200': {
      description: 'Current cart items',
      content: { 'application/json': { schema: cartItemListSchema } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/cart/items',
  tags: ['cart'],
  security: tenantSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            productId: z.number().int().positive(),
            quantity: z.number().int().positive(),
          }),
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Cart item upserted (existing quantity is incremented)',
      content: { 'application/json': { schema: cartItemListSchema.element } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'patch',
  path: '/cart/items/{productId}',
  tags: ['cart'],
  security: tenantSecurity,
  request: {
    params: z.object({ productId: z.coerce.number().int().positive() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ quantity: z.number().int().positive() }),
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Updated cart item',
      content: { 'application/json': { schema: cartItemListSchema.element } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'delete',
  path: '/cart/items/{productId}',
  tags: ['cart'],
  security: tenantSecurity,
  request: { params: z.object({ productId: z.coerce.number().int().positive() }) },
  responses: { '204': { description: 'Cart item removed' }, ...errorResponses },
})
registry.registerPath({
  method: 'delete',
  path: '/cart',
  tags: ['cart'],
  security: tenantSecurity,
  responses: { '204': { description: 'Cart cleared' }, ...errorResponses },
})
registry.registerPath({
  method: 'post',
  path: '/cart/checkout',
  tags: ['cart'],
  security: tenantSecurity,
  responses: {
    '201': {
      description: 'Cart materialized into a pending order; cart cleared',
      content: { 'application/json': { schema: schemaRefs.order } },
    },
    ...errorResponses,
  },
})

// Admin
registry.registerPath({
  method: 'post',
  path: '/admin/auth/login',
  tags: ['admin'],
  request: { body: { content: { 'application/json': { schema: adminLoginSchema } } } },
  responses: {
    '200': {
      description: 'Platform access token',
      content: {
        'application/json': {
          schema: z.object({
            accessToken: z.string(),
            admin: z.object({ id: z.number().int(), email: z.string().email() }),
          }),
        },
      },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/admin/tenants',
  tags: ['admin'],
  security: platformSecurity,
  responses: {
    '200': {
      description: 'Tenants',
      content: { 'application/json': { schema: z.array(schemaRefs.tenant) } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/admin/tenants',
  tags: ['admin'],
  security: platformSecurity,
  request: { body: { content: { 'application/json': { schema: createTenantSchema } } } },
  responses: {
    '201': {
      description: 'Tenant created',
      content: { 'application/json': { schema: schemaRefs.tenant } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'patch',
  path: '/admin/tenants/{id}',
  tags: ['admin'],
  security: platformSecurity,
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: { content: { 'application/json': { schema: updateTenantSchema } } },
  },
  responses: {
    '200': {
      description: 'Tenant renamed',
      content: { 'application/json': { schema: schemaRefs.tenant } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'delete',
  path: '/admin/tenants/{id}',
  tags: ['admin'],
  security: platformSecurity,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    '204': { description: 'Tenant deleted' },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/admin/orders',
  tags: ['admin'],
  security: platformSecurity,
  request: { query: listOrdersAdminQuerySchema },
  responses: {
    '200': {
      description: 'Cross-tenant order list',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(schemaRefs.order),
            total: z.number().int(),
            page: z.number().int(),
            pageSize: z.number().int(),
          }),
        },
      },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/admin/payments',
  tags: ['admin'],
  security: platformSecurity,
  request: { query: listPaymentsAdminQuerySchema },
  responses: {
    '200': {
      description: 'Cross-tenant payment list',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(schemaRefs.payment),
            total: z.number().int(),
            page: z.number().int(),
            pageSize: z.number().int(),
          }),
        },
      },
    },
    ...errorResponses,
  },
})

// Store BFF (商家后台，tenant-scoped admin role)
registry.registerPath({
  method: 'get',
  path: '/store/orders',
  tags: ['store'],
  security: tenantSecurity,
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
      status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).optional(),
      userId: z.coerce.number().int().positive().optional(),
    }),
  },
  responses: {
    '200': {
      description: 'Orders across all users in this tenant',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(schemaRefs.order),
            total: z.number().int(),
            page: z.number().int(),
            pageSize: z.number().int(),
          }),
        },
      },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'post',
  path: '/store/orders/{id}/ship',
  tags: ['store'],
  security: tenantSecurity,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    '200': {
      description: 'Order shipped',
      content: { 'application/json': { schema: schemaRefs.order } },
    },
    ...errorResponses,
  },
})
registry.registerPath({
  method: 'get',
  path: '/store/dashboard',
  tags: ['store'],
  security: tenantSecurity,
  responses: {
    '200': {
      description: 'Store dashboard aggregates',
      content: {
        'application/json': {
          schema: z.object({
            ordersByStatus: z.record(
              z.string(),
              z.object({ count: z.number().int(), totalCents: z.number().int() }),
            ),
            productCount: z.number().int(),
            lowStockProducts: z.number().int(),
            lowStockThreshold: z.number().int(),
            reservedStockTotal: z.number().int(),
          }),
        },
      },
    },
    ...errorResponses,
  },
})

export {}
