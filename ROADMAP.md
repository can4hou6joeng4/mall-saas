# Roadmap

> mall-saas 是一个边演进边交付的多租户 SaaS 电商样板。本文档记录已交付的里程碑链与未来方向。

## 已交付（v0.1-m1 → v0.34-m34）

完整 34 个里程碑见 [GitHub Releases](https://github.com/can4hou6joeng4/mall-saas/releases) 与 [git tag](https://github.com/can4hou6joeng4/mall-saas/tags)。每个 tag 都对应一个可复跑的 `scripts/m{N}-acceptance.sh` 端到端验收脚本。

| 阶段 | 范围 | 关键里程碑 |
|------|------|-----------|
| 后端骨架 | M1 – M10 | monorepo 骨架 · RLS · 多租户 · 商品 / 订单 / 支付 · JWT refresh + Redis whitelist |
| 业务能力 | M11 – M17 | 购物车 · 预占库存 · Stripe + Mock provider · 优惠券（atomic UPDATE） · 文件存储抽象 · i18n |
| 三前端 | M18 – M23 | admin Playwright e2e · storefront · 三前端 401 自动 refresh · store 订单详情 + 优惠券管理 · storefront 支付闭环 |
| 可观测 & 部署 | M24 – M30 | W3C trace context · 生产 docker compose + migrate stage · admin tenant / payment 详情 · 用户管理 · admin 重置密码 · GHCR release |
| 工程化 | M31 – M34 | storefront 优惠券拉通 · 三前端 Playwright · storefront i18n · OpenTelemetry SDK |

## 候选方向（未排序，欢迎在 [Discussions](https://github.com/can4hou6joeng4/mall-saas/discussions) 投票）

### 工程化与可观测

- 接入 OTLP collector + Jaeger/Tempo 演示部署，提供完整 trace 仪表
- 接入 Sentry / Bugsnag 错误聚合
- 接入 codecov / coveralls 测试覆盖率
- GitHub Pages 部署 OpenAPI Swagger UI + 架构图站点

### 业务能力

- 商家自助注册 + 多步骤入驻流程
- 商家审核中后台（platform admin 视角）
- 退款 / 售后流程
- 多币种 / 汇率
- 优惠券进阶：使用门槛叠加规则、组合优惠、首单券
- 库存预警与补货建议

### 前端体验

- storefront SSR / 静态化首页（接入 Vite SSR 或迁移 Next.js 评估）
- 三前端 Dark Mode 统一主题
- storefront 商品详情页 + 图片画廊
- admin 数据看板（按租户健康度 / 营收 / 退款率）

### 部署与发布

- Helm Chart（Kubernetes 一键部署）
- Terraform / Pulumi 基础设施模板（AWS / GCP / Azure 任选一）
- 镜像多架构 manifest（amd64 + arm64）

### 文档与社区

- README 英文版（README.en.md）
- 视频演示 / 截图 GIF
- DEV.to / Medium 系列文章解读关键设计决策
- 中文社区运营（V2EX / 掘金 / Ruby China）

## 贡献方向

如果你愿意参与，可以：

1. 浏览 [Issues](https://github.com/can4hou6joeng4/mall-saas/issues) 中标记 `good first issue` / `help wanted` 的任务
2. 在 [Discussions](https://github.com/can4hou6joeng4/mall-saas/discussions) 提案新方向
3. 阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发流程与提交规范
4. 复跑任一 `scripts/m{N}-acceptance.sh` 给现有里程碑做兼容性回归

## 设计原则

- **多租户隔离是底线**：任何新功能必须显式声明 tenant 边界（schema 必须带 `tenantId`，service 必须走 `PrismaService.withTenant`）。
- **每个里程碑可验证**：新增功能必须有对应 `scripts/m{N}-acceptance.sh` 跑端到端，确保任何外部用户能复跑。
- **后端 OpenAPI 即契约**：前端类型从 `apps/api/openapi.json` codegen，禁止前端硬编码后端字段。
- **生产可观测优先**：每条 API 请求必须留下 trace（M24 W3C trace context）+ structured log（pino）+ /metrics（Prometheus）。
