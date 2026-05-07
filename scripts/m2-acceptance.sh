#!/usr/bin/env bash
# M2 验收冒烟：在 M1 基础上叠加租户路径与商品域回归
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m2-smoke"
HOST_PORT="${HOST_PORT:-3002}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

step() {
  echo
  echo "=== [$1] $2 ==="
}

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step 1/7 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/7 "应用 Prisma 迁移"
pnpm --filter @mall/api exec prisma migrate deploy

step 3/7 "类型检查 / Lint"
pnpm typecheck
pnpm lint

step 4/7 "运行所有测试（含 RLS / 商品 / 错误形状 e2e）"
pnpm test

step 5/7 "构建所有包"
pnpm build

step 6/7 "构建镜像并启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

# 等待 healthz 就绪
for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "container exited early, logs:" >&2; docker logs "${CONTAINER}" >&2; exit 1
  fi
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout waiting for healthz" >&2; docker logs "${CONTAINER}" >&2; exit 1; }
done

step 7/7 "命中租户路径"
echo "-- /ping 缺 header 应 401"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/ping")
[[ "${code}" == "401" ]] || { echo "/ping without header expected 401 got ${code}" >&2; exit 1; }

echo "-- /ping 带 header 应 200 + tenantId echo"
body=$(curl -sf -H 'x-tenant-id: 1' "http://127.0.0.1:${HOST_PORT}/ping")
[[ "${body}" == '{"ok":true,"tenantId":1}' ]] || { echo "unexpected ping body: ${body}" >&2; exit 1; }

echo "-- /products 列表（tenant 1，不关心实际行数，只关心成功响应结构）"
body=$(curl -sf -H 'x-tenant-id: 1' "http://127.0.0.1:${HOST_PORT}/products?page=1&pageSize=5")
echo "${body}" | grep -q '"items":' || { echo "unexpected products body: ${body}" >&2; exit 1; }
echo "${body}" | grep -q '"total":' || { echo "missing total in products body: ${body}" >&2; exit 1; }

echo
echo "✅ M2 验收冒烟全部通过"
