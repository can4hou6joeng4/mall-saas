#!/usr/bin/env bash
# M6 验收冒烟：在 M5 基础上叠加 平台超管 → 创建 tenant → 跨租户查 order/payment 全链
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m6-acceptance-mock-secret}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m6-smoke"
HOST_PORT="${HOST_PORT:-3006}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/8 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/8 "应用 Prisma 迁移"
pnpm --filter @mall/api exec prisma migrate deploy

step 3/8 "类型检查 / Lint"
pnpm typecheck
pnpm lint

step 4/8 "运行所有测试"
pnpm test

step 5/8 "构建所有包"
pnpm build

step 6/8 "构建镜像并启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
# 先清掉表里历史 platform admin，验证 bootstrap 路径
docker exec -i mall-postgres psql -U mall -d mall -c \
  'DELETE FROM "PlatformAdmin";' >/dev/null

docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e JWT_TTL_SECONDS="${JWT_TTL_SECONDS}" \
  -e PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET}" \
  -e PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL}" \
  -e PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD}" \
  -e ORDER_TIMEOUT_MS=1800000 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "container exited:" >&2; docker logs "${CONTAINER}" >&2; exit 1
  fi
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout waiting healthz" >&2; docker logs "${CONTAINER}" >&2; exit 1; }
done

step 7/8 "验证 bootstrap 已写入 PlatformAdmin"
count=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  'SELECT count(*) FROM "PlatformAdmin";')
[[ "${count}" -ge 1 ]] || { echo "bootstrap failed, count=${count}" >&2; exit 1; }

step 8/8 "platform 登录 → 创建 tenant → 跨租户查 order/payment"

echo "-- 平台超管登录"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${PLATFORM_ADMIN_EMAIL}\",\"password\":\"${PLATFORM_ADMIN_PASSWORD}\"}")
admin_token=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "${admin_token}" ]] || { echo "admin login failed: ${admin_resp}" >&2; exit 1; }

echo "-- 无 token 调 /admin/tenants 应 401"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/admin/tenants")
[[ "${code}" == "401" ]] || { echo "expected 401 got ${code}" >&2; exit 1; }

echo "-- 平台超管创建 tenant"
tenant_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/tenants" \
  -H "authorization: Bearer ${admin_token}" -H 'content-type: application/json' \
  -d '{"name":"m6-acceptance-tenant"}')
tenant_id=$(echo "${tenant_resp}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
[[ -n "${tenant_id}" ]] || { echo "create tenant failed: ${tenant_resp}" >&2; exit 1; }

echo "-- 平台超管列出 tenants"
list=$(curl -sf "http://127.0.0.1:${HOST_PORT}/admin/tenants" \
  -H "authorization: Bearer ${admin_token}")
echo "${list}" | grep -q "m6-acceptance-tenant" || {
  echo "tenant not in list: ${list}" >&2; exit 1
}

echo "-- 平台超管跨租户查询 orders（响应结构）"
orders=$(curl -sf "http://127.0.0.1:${HOST_PORT}/admin/orders?page=1&pageSize=5" \
  -H "authorization: Bearer ${admin_token}")
echo "${orders}" | grep -q '"items":' || { echo "bad orders body: ${orders}" >&2; exit 1; }
echo "${orders}" | grep -q '"total":' || { echo "missing total: ${orders}" >&2; exit 1; }

echo "-- 平台超管跨租户查询 payments"
payments=$(curl -sf "http://127.0.0.1:${HOST_PORT}/admin/payments?page=1&pageSize=5" \
  -H "authorization: Bearer ${admin_token}")
echo "${payments}" | grep -q '"items":' || { echo "bad payments body: ${payments}" >&2; exit 1; }

echo "-- platform token 调租户路由 /products 应 401（scope 隔离）"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${admin_token}")
[[ "${code}" == "401" ]] || { echo "platform→tenant expected 401 got ${code}" >&2; exit 1; }

echo
echo "✅ M6 验收冒烟全部通过"
