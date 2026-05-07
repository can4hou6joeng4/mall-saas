import './extend-zod.js'
import './paths.js'
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { registry } from './registry.js'

export interface BuiltOpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: { url: string; description?: string }[]
  tags?: { name: string; description?: string }[]
  paths: Record<string, unknown>
  components?: Record<string, unknown>
}

export function buildOpenApiDocument(): BuiltOpenApiDocument {
  const generator = new OpenApiGeneratorV3(registry.definitions)
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Mall API',
      version: '0.8.0',
      description:
        '多租户商城 API。/auth、/products、/orders、/orders/:id/pay 等业务路径需 tenant Bearer JWT；/admin/* 需 platform Bearer JWT；/healthz、/readyz、/metrics、/webhooks/* 公开。',
    },
    servers: [{ url: 'http://localhost:3000', description: 'local dev' }],
    tags: [
      { name: 'health', description: 'Liveness / readiness' },
      { name: 'observability', description: 'Prometheus metrics' },
      { name: 'auth', description: 'Tenant 用户注册 / 登录' },
      { name: 'product', description: 'Tenant 商品 CRUD' },
      { name: 'order', description: 'Tenant 订单 / 库存' },
      { name: 'payment', description: 'Tenant 支付 + Provider Webhook' },
      { name: 'admin', description: 'Platform 超管入口' },
    ],
  }) as unknown as BuiltOpenApiDocument
}
