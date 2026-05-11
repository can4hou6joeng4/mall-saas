#!/usr/bin/env bash
# M14 验收冒烟：商家后台 BFF + Store 前端构建产物
# 链路：商家登录 → 商品 → 用户下单 + 模拟支付（mock webhook）→ 商家发货 → dashboard 数据
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m14-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m14-smoke"
HOST_PORT="${HOST_PORT:-3014}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9500}"
MERCHANT_EMAIL="merchant-m14@example.com"
SHOPPER_EMAIL="shopper-m14@example.com"
PW="m14-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/8 "依赖容器 + 类型/lint/测试/构建（含 admin + store 工作区）"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/8 "校验 store 静态产物"
[[ -f "${ROOT}/apps/store/dist/index.html" ]] || { echo "missing apps/store/dist/index.html" >&2; exit 1; }
size=$(wc -c < "${ROOT}/apps/store/dist/index.html")
[[ "${size}" -gt 100 ]] || { echo "store index.html too small" >&2; exit 1; }
echo "  ✓ apps/store/dist 已生成（index.html ${size}B）"

step 3/8 "构建镜像 + 起容器"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm14-merchant') ON CONFLICT (id) DO NOTHING;
DELETE FROM "CartItem" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Payment" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "User" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Product" WHERE "tenantId" = ${TENANT_ID};
SQL

docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET}" \
  -e PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL}" \
  -e PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD}" \
  -e ORDER_TIMEOUT_MS=1800000 \
  -e AUTH_RATE_LIMIT_MAX=200 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout"; docker logs "${CONTAINER}"; exit 1; }
done

step 4/8 "商家登录（admin role）+ 创建商品 stock=4"
m_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${MERCHANT_EMAIL}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
mtoken=$(echo "${m_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${mtoken}" -H 'content-type: application/json' \
  -d '{"name":"m14-sku","priceCents":2500,"stock":4}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

step 5/8 "用户注册 + 下单 + mock 支付成功"
u_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${SHOPPER_EMAIL}\",\"password\":\"${PW}\"}")
utoken=$(echo "${u_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

order=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${pid},\"quantity\":2}]}")
oid=$(echo "${order}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

pay=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders/${oid}/pay" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d '{"provider":"mock"}')
pref=$(echo "${pay}" | sed -n 's/.*"providerRef":"\([^"]*\)".*/\1/p')

body="{\"providerRef\":\"${pref}\",\"status\":\"succeeded\"}"
sig=$(printf '%s' "${body}" | openssl dgst -sha256 -hmac "${PAYMENT_MOCK_SECRET}" -hex | awk '{print $NF}')
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/mock" \
  -H 'content-type: application/json' -H "x-mock-signature: ${sig}" \
  -d "${body}")
[[ "${code}" == "200" ]] || { echo "mock webhook expected 200 got ${code}" >&2; exit 1; }

step 6/8 "商家通过 /store/orders 看到这单（status=paid）"
list=$(curl -sf "http://127.0.0.1:${HOST_PORT}/store/orders?status=paid" \
  -H "authorization: Bearer ${mtoken}")
echo "${list}" | grep -q "\"id\":${oid}" || {
  echo "merchant didn't see paid order: ${list}" >&2; exit 1
}

step 7/8 "商家发货 → status=shipped；二次发货应 409"
ship=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/store/orders/${oid}/ship" \
  -H "authorization: Bearer ${mtoken}")
echo "${ship}" | grep -q '"status":"shipped"' || { echo "ship body: ${ship}" >&2; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/store/orders/${oid}/ship" \
  -H "authorization: Bearer ${mtoken}")
[[ "${code}" == "409" ]] || { echo "double ship expected 409 got ${code}" >&2; exit 1; }

step 8/8 "Dashboard 数据正确（productCount≥1, shipped≥1, lowStock 反映 stock=2）"
dash=$(curl -sf "http://127.0.0.1:${HOST_PORT}/store/dashboard" \
  -H "authorization: Bearer ${mtoken}")
echo "${dash}" | grep -q '"productCount":1' || {
  echo "expected productCount=1: ${dash}" >&2; exit 1
}
echo "${dash}" | grep -q '"lowStockProducts":1' || {
  echo "expected lowStockProducts=1 (stock=2 ≤ 5): ${dash}" >&2; exit 1
}
echo "${dash}" | grep -q '"shipped":{"count":1' || {
  echo "expected shipped count=1: ${dash}" >&2; exit 1
}

echo
echo "✅ M14 验收冒烟全部通过"
