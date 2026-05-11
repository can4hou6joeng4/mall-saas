# Changelog

按里程碑（M{N}）+ 语义化版本（vX.Y.Z）演进。每个 release 同时有 git tag、`scripts/m{N}-acceptance.sh` 端到端验收脚本与 GitHub Release notes。

完整 release notes 见 <https://github.com/can4hou6joeng4/mall-saas/releases>。

## [Unreleased]

- 开源治理：CodeQL 安全扫描、ROADMAP、CHANGELOG、Dependabot 多生态、社区健康度 100%
- release.yml 支持 `workflow_dispatch` 回填首次发布
- 多架构镜像（amd64 + arm64）GHCR 推送

## [v0.34.0-m34] — OpenTelemetry SDK

- 接入 `@opentelemetry/sdk-node` + auto-instrumentations（fastify / http / pg / ioredis）
- env `OTEL_ENABLED=true` 开启；`OTEL_EXPORTER=otlp|console` 双导出
- 兼容验证：M24 W3C traceparent 在 OTel 启用后仍正确 reuse 上游 traceId

## [v0.33.0-m33] — storefront i18n

- 60+ key 中英文字典 + `useT` hook + `<I18nProvider>`
- 5 个页面文案 i18n 化（Login / Products / Cart / Orders / OrderDetail）+ App nav locale switcher
- API client 自动注入 `Accept-Language: ${storedLocale}`，与后端 M17 BusinessException 字典拉通

## [v0.32.0-m32] — 三前端 Playwright e2e

- storefront + store 补 Playwright（admin M18 已有），4 个浏览器级用例
- acceptance 脚本串起来跑全 4 case

## [v0.31.0-m31] — storefront 结账接 couponCode

- `POST /cart/checkout` 接 `couponCode` 字段 → 透传给 `orders.create`
- storefront CartPage 加优惠券输入框，成功展示折扣金额

## [v0.30.0-m30] — GHCR release 工作流

- `.github/workflows/release.yml`：on push tag v* → 构建 runner + migrate 双镜像 → push GHCR
- 自动打 latest tag（仅稳定 vX.Y.Z）

## [v0.29.0-m29] — admin 一次性临时密码重置

- `POST /admin/users/:id/reset-password` → 返回 16 位强随机临时密码（一次性）
- 旧密码立即失效；不绕过 lock 状态

## [v0.28.0-m28] — admin 跨租户用户管理 + lock

- `GET /admin/users` 跨租户列表（按 tenantId / email / role 过滤）
- `PATCH /admin/users/:id/lock`：lock=true 后 login 直接 401

## [v0.27.0-m27] — admin payment 详情聚合

- `GET /admin/payments/:id`：payment + order（含 items）+ tenant 完整视图
- 跨租户排障一站式

## [v0.26.0-m26] — admin tenant 健康度详情

- `GET /admin/tenants/:id`：聚合订单状态分桶 / 商品数 / 用户数 / 累计营收

## [v0.25.0-m25] — 生产 docker compose 编排

- `docker-compose.prod.yml`：postgres + redis + migrate(target=migrate) + api(target=runner)
- `service_completed_successfully` 串联，migrate 跑完才起 api
- `.env.prod.example` 必填项 + 安全说明

## [v0.24.0-m24] — W3C Trace Context

- 入站 `traceparent` 解析，自动 generate / reuse traceId（32-hex）
- pino 每条 log 自动带 `traceId` / `spanId` / `parentSpanId`
- 出站 `traceresponse` header 让上游可溯源
- error response.requestId === traceId（单一 id 语义）

## [v0.23.0-m23] — storefront 订单详情 + 支付闭环

- storefront OrderDetailPage（含支付按钮 + pending 状态 3s 轮询）
- 完整链路：pending → /orders/:id/pay → mock webhook（HMAC）→ paid

## [v0.22.0-m22] — CI shellcheck + turbo cache + acceptance-smoke

- shellcheck job 检查所有 scripts/*.sh
- turbo cache 加速重复 CI
- acceptance-smoke 用 PSQL_CMD + SKIP_PIPELINE 旋钮复用 m21-acceptance.sh

## [v0.21.0-m21] — store 订单详情 + 优惠券管理

- `GET /store/orders/:id`：包含 user / coupon / payments 的完整详情
- store OrderDetailPage（含 ship 按钮）+ CouponsPage（创建 / 列表 / 停用）
- Coupon openapi schema 抽出共用 ref

## [v0.20.0-m20] — 三前端 401 自动 refresh

- store + storefront 单飞 `/auth/refresh` + 401 自动重试
- admin 401 自动 `clearToken` 跳回登录页
- 4 个 jsdom 单测覆盖单 401 / refresh 失败 / 并发单飞 / `/auth/*` 不递归

## [v0.19.0-m19] — storefront 工作区与购物全链路

- 全新 `apps/storefront`：login / products / cart / orders 4 页
- 端到端：admin 创建商品 → user 注册 → 加购 → checkout → 我的订单 → 购物车清空

## [v0.18.0-m18] — admin Playwright E2E

- `apps/admin/e2e/admin-login.spec.ts`：路由 mock，preview server 跑浏览器级 e2e
- 2 个 case：登录成功 / 登录失败

## [v0.17.0-m17] — i18n（后端）

- `BusinessException` 携带 messageKey + params
- en / zh-CN 字典覆盖商品 / 订单 / 优惠券 / 鉴权
- Accept-Language header 自动选 locale

## [v0.16.0-m16] — 文件存储抽象

- `StorageProvider` 接口 + `LocalStorageProvider` 本地实现
- 商品图片上传 + 多图管理

## [v0.15.0-m15] — 优惠券

- 支持 PERCENT / AMOUNT 两种折扣
- maxUsage 用 atomic `UPDATE WHERE usageCount < maxUsage` 防并发超用

## [v0.14.0-m14] — 平台 BFF（admin 端）

- `/admin/auth/login` + 跨租户只读 `/admin/orders` / `/admin/payments`
- platform scope JWT 与 tenant scope JWT 严格区分

## [v0.13.0-m13] — Stripe Payment Provider

- `StripePaymentProvider` 实现，webhook 签名校验
- stripe-mock 本地集成测试

## [v0.12.0-m12] — 购物车 + 预占库存

- `CartItem` + `/cart` 全套 CRUD
- 预占语义：pending=reserve / paid=consume / cancelled=release

## [v0.11.0-m11] — 商家 BFF

- `/store/orders` / `/store/dashboard` 商家视角聚合

## [v0.10.0-m10] — JWT refresh + Redis whitelist

- refresh token 写入 Redis（TTL = JWT_REFRESH_TTL_SECONDS）
- 旋转即把旧 jti 失效

## [v0.9.0-m9] — i18n_skeleton（提前预留 i18n 接口）

## [v0.8.0-m8] — Payment 模型 + Mock provider

## [v0.7.0-m7] — 订单状态机

## [v0.6.0-m6] — 商品 CRUD

## [v0.5.0-m5] — 用户注册 + 登录

## [v0.4.0-m4] — BullMQ 订单超时自动取消

## [v0.3.0-m3] — RLS 多租户隔离

## [v0.2.0-m2] — Prisma schema + 基础 model

## [v0.1.0-m1] — monorepo 骨架

[Unreleased]: https://github.com/can4hou6joeng4/mall-saas/compare/v0.34.0-m34...HEAD
[v0.34.0-m34]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.34.0-m34
[v0.33.0-m33]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.33.0-m33
[v0.32.0-m32]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.32.0-m32
[v0.31.0-m31]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.31.0-m31
[v0.30.0-m30]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.30.0-m30
[v0.29.0-m29]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.29.0-m29
[v0.28.0-m28]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.28.0-m28
[v0.27.0-m27]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.27.0-m27
[v0.26.0-m26]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.26.0-m26
[v0.25.0-m25]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.25.0-m25
[v0.24.0-m24]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.24.0-m24
[v0.23.0-m23]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.23.0-m23
[v0.22.0-m22]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.22.0-m22
[v0.21.0-m21]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.21.0-m21
[v0.20.0-m20]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.20.0-m20
[v0.19.0-m19]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.19.0-m19
[v0.18.0-m18]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.18.0-m18
[v0.17.0-m17]: https://github.com/can4hou6joeng4/mall-saas/releases/tag/v0.17.0-m17
