#!/usr/bin/env bash
# M1 验收冒烟：拉通 typecheck / lint / test / build / 镜像 smoke 一次性闭环
# 前置：docker compose up -d postgres redis 已经起好，且 DATABASE_URL 指向它
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-local-mock-payment-secret}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

step() {
  echo
  echo "=== [$1] $2 ==="
}

step 1/6 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null || {
  echo "postgres/redis 未启动，请先执行 docker compose up -d postgres redis" >&2
  exit 1
}

step 2/6 "应用 Prisma 迁移（migrate deploy）"
pnpm --filter @mall/api exec prisma migrate deploy

step 3/6 "类型检查 / Lint"
pnpm typecheck
pnpm lint

step 4/6 "运行所有测试（含 e2e）"
pnpm test

step 5/6 "构建所有包"
pnpm build

step 6/6 "镜像构建 + 容器健康冒烟"
"${ROOT}/apps/api/scripts/docker-smoke.sh"

echo
echo "✅ M1 验收冒烟全部通过"
