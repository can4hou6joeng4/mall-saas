# new-mall

商城 SaaS 绿地重做项目。本仓库实现 `docs/research/2026-05-05-decision.md` 的 C2 组合。

## 启动本地开发环境

```bash
docker compose up -d
cp .env.example .env
pnpm install
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api dev
```

打开 <http://localhost:3000/docs> 查看 Swagger；<http://localhost:3000/healthz> 验证健康。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有包的单测 / e2e |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm build` | 构建所有包到 `dist/` |
| `docker build -f apps/api/Dockerfile -t mall-api:dev .` | 构建生产镜像 |

## 文档

- `docs/research/` 选型调研
- `docs/adr/` 架构决策记录
- `docs/superpowers/plans/` 实施计划
