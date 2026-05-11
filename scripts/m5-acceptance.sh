#!/usr/bin/env bash
# M5 验收冒烟：在 M4 基础上叠加 支付 → webhook → 订单状态机推进
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m5-acceptance-mock-secret}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m5-smoke"
HOST_PORT="${HOST_PORT:-3005}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9003}"
ADMIN_EMAIL="m5-admin@example.com"
USER_EMAIL="m5-user@example.com"
PASSWORD="m5-acceptance-pw!"

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
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e JWT_TTL_SECONDS="${JWT_TTL_SECONDS}" \
  -e PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET}" \
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
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'acceptance-m5') ON CONFLICT (id) DO NOTHING;
DELETE FROM "Payment" WHERE "tenantId" = ${TENANT_ID};
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

prod_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${admin_token}" -H 'content-type: application/json' \
  -d '{"name":"m5-sku","priceCents":2000,"stock":3}')
prod_id=$(echo "${prod_resp}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

step 8/8 "下单 → 发起支付 → 签名 webhook → 订单 paid"

echo "-- user 下单 quantity=1"
order_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${prod_id},\"quantity\":1}]}")
order_id=$(echo "${order_resp}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

echo "-- user 发起 mock 支付"
pay_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders/${order_id}/pay" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d '{"provider":"mock"}')
provider_ref=$(echo "${pay_resp}" | sed -n 's/.*"providerRef":"\([^"]*\)".*/\1/p')
[[ -n "${provider_ref}" ]] || { echo "pay failed: ${pay_resp}" >&2; exit 1; }

echo "-- 构造签名 webhook（成功）"
body="{\"providerRef\":\"${provider_ref}\",\"status\":\"succeeded\"}"
sig=$(printf '%s' "${body}" | openssl dgst -sha256 -hmac "${PAYMENT_MOCK_SECRET}" -hex | awk '{print $NF}')
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/mock" \
  -H 'content-type: application/json' -H "x-mock-signature: ${sig}" \
  -d "${body}")
[[ "${code}" == "200" ]] || { echo "webhook expected 200 got ${code}" >&2; exit 1; }

echo "-- 验证订单 status=paid"
status=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT status FROM \"Order\" WHERE id = ${order_id};")
[[ "${status}" == "paid" ]] || { echo "expected status=paid got '${status}'" >&2; exit 1; }

echo "-- bad signature 应 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/mock" \
  -H 'content-type: application/json' -H "x-mock-signature: deadbeef" \
  -d "${body}")
[[ "${code}" == "401" ]] || { echo "bad sig expected 401 got ${code}" >&2; exit 1; }

echo "-- 已 paid 订单再次发起支付应 409"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/orders/${order_id}/pay" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d '{"provider":"mock"}')
[[ "${code}" == "409" ]] || { echo "double pay expected 409 got ${code}" >&2; exit 1; }

echo
echo "✅ M5 验收冒烟全部通过"
