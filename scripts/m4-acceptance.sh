#!/usr/bin/env bash
# M4 验收冒烟：在 M3 基础上叠加 商品 → 下单 → 库存 → 取消 → 恢复 全链回归
# 前置：docker compose up -d postgres redis
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

CONTAINER="mall-api-m4-smoke"
HOST_PORT="${HOST_PORT:-3004}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9002}"
ADMIN_EMAIL="m4-admin@example.com"
USER_EMAIL="m4-user@example.com"
PASSWORD="m4-acceptance-pw!"

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

step 4/8 "运行所有测试（含 order CRUD + BullMQ timeout）"
pnpm test

step 5/8 "构建所有包"
pnpm build

step 6/8 "构建镜像并启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e JWT_TTL_SECONDS="${JWT_TTL_SECONDS}" \
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

step 7/8 "准备 acceptance 用租户与用户"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'acceptance-m4') ON CONFLICT (id) DO NOTHING;
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Product" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "User" WHERE "tenantId" = ${TENANT_ID};
SQL

admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${PASSWORD}\",\"role\":\"admin\"}")
admin_token=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER_EMAIL}\",\"password\":\"${PASSWORD}\",\"role\":\"user\"}")
user_token=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

step 8/8 "下单 → 库存 → 取消 → 库存恢复 全链"

echo "-- admin 创建商品 stock=5"
prod_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${admin_token}" -H 'content-type: application/json' \
  -d '{"name":"acceptance-sku","priceCents":1000,"stock":5}')
prod_id=$(echo "${prod_resp}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

echo "-- user 下单 quantity=3"
order_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${prod_id},\"quantity\":3}]}")
order_id=$(echo "${order_resp}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

echo "-- 验证库存扣到 2"
stock=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT stock FROM \"Product\" WHERE id = ${prod_id};")
[[ "${stock}" == "2" ]] || { echo "expected stock=2 got '${stock}'" >&2; exit 1; }

echo "-- user 超量下单 quantity=10 应 409"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${prod_id},\"quantity\":10}]}")
[[ "${code}" == "409" ]] || { echo "expected 409 got ${code}" >&2; exit 1; }

echo "-- user 取消订单 ${order_id}"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/orders/${order_id}/cancel" \
  -H "authorization: Bearer ${user_token}")
[[ "${code}" == "200" ]] || { echo "cancel expected 200 got ${code}" >&2; exit 1; }

echo "-- 验证库存恢复到 5"
stock=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT stock FROM \"Product\" WHERE id = ${prod_id};")
[[ "${stock}" == "5" ]] || { echo "expected stock=5 got '${stock}'" >&2; exit 1; }

echo "-- /readyz 含 redis check"
ready=$(curl -sf "http://127.0.0.1:${HOST_PORT}/readyz")
echo "${ready}" | grep -q '"redis":"ok"' || { echo "redis not ok in readyz: ${ready}" >&2; exit 1; }

echo
echo "✅ M4 验收冒烟全部通过"
