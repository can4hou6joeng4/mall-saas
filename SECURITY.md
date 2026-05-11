# 安全策略

## 报告漏洞

我们非常重视 mall-saas 的安全问题。如果你发现安全漏洞，请按以下流程私下披露，**不要**在公开 Issue 中提交：

1. 优先使用 GitHub Security Advisory：
   <https://github.com/can4hou6joeng4/mall-saas/security/advisories/new>
2. 或发送邮件至 **can4hou6joeng4@163.com**，主题以 `[security] mall-saas:` 开头。

请在报告中说明：

- 受影响的版本 / commit / tag
- 漏洞类型（SQL 注入 / 越权 / RCE / 信息泄露 / RLS 绕过 ...）
- 复现步骤（最小可行示例）
- 已确认的影响范围

我们会在 **5 个工作日内**响应初步评估，并在确认漏洞后协同披露与发布修复版本。

## 支持的版本

mall-saas 目前处于 0.x 阶段，仅对 **最新一个 minor**（`main` 分支与最近一个 `v0.x.0-m{N}` tag）提供安全修复。

## 已知安全设计

- **多租户隔离**：PostgreSQL Row-Level Security + 非超管运行时角色（`mall_app`），最后一道防线
- **鉴权**：JWT access + refresh 双 token，refresh 走 Redis 白名单，旋转即失效
- **支付**：webhook HMAC 签名 + 幂等回调
- **请求追踪**：W3C Trace Context 全链路注入，便于事后审计
- **超管账号**：环境变量 bootstrap，密码强制 hash 存储（不可逆）

## 不在范围

- 已知第三方依赖漏洞——请向上游报告，我们通过 Dependabot 跟随升级
- 仅在已被攻陷环境（已获 root）下才能复现的攻击
- 社会工程学攻击
- DoS / 速率攻击——我们已用 `@fastify/rate-limit` 做基础防护，进一步加固由部署侧负责
