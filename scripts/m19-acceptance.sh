#!/usr/bin/env bash
# M19 验收冒烟：消费者前端 storefront 端到端
# 商家创建商品 → user 注册 → 加购物车 → checkout → 我的订单含该订单
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m19-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m19-smoke"
HOST_PORT="${HOST_PORT:-3019}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9900}"
ADMIN="m19-admin@example.com"
USER="m19-user@example.com"
PW="m19-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/6 "依赖容器 + 全工作区测试 + 构建（含 storefront）"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/6 "校验 storefront 静态产物"
[[ -f "${ROOT}/apps/storefront/dist/index.html" ]] || { echo "missing storefront dist" >&2; exit 1; }
size=$(wc -c < "${ROOT}/apps/storefront/dist/index.html")
[[ "${size}" -gt 100 ]] || { echo "storefront index.html too small" >&2; exit 1; }
echo "  ✓ apps/storefront/dist 已生成（index.html ${size}B）"

step 3/6 "构建镜像 + 启容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm19-acc') ON CONFLICT (id) DO NOTHING;
DELETE FROM "ProductImage" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "CartItem" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Payment" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Coupon" WHERE "tenantId" = ${TENANT_ID};
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

step 4/6 "admin 创建商品 + user 注册"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m19-sku","priceCents":3000,"stock":10}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
utoken=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

step 5/6 "user 加购物车 → checkout → 订单 pending"
curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/items" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"productId\":${pid},\"quantity\":2}" >/dev/null

cart=$(curl -sf "http://127.0.0.1:${HOST_PORT}/cart" -H "authorization: Bearer ${utoken}")
echo "${cart}" | grep -q "\"productId\":${pid}" || { echo "cart missing item: ${cart}" >&2; exit 1; }

co=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/checkout" \
  -H "authorization: Bearer ${utoken}")
oid=$(echo "${co}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "${co}" | grep -q '"status":"pending"' || { echo "expected pending: ${co}" >&2; exit 1; }
echo "  ✓ checkout 创建订单 #${oid}"

step 6/6 "user GET /orders 看到该订单 + 购物车清空"
list=$(curl -sf "http://127.0.0.1:${HOST_PORT}/orders" -H "authorization: Bearer ${utoken}")
echo "${list}" | grep -q "\"id\":${oid}" || { echo "order list missing id ${oid}: ${list}" >&2; exit 1; }
empty=$(curl -sf "http://127.0.0.1:${HOST_PORT}/cart" -H "authorization: Bearer ${utoken}")
[[ "${empty}" == "[]" ]] || { echo "cart not cleared: ${empty}" >&2; exit 1; }
echo "  ✓ 订单列表含 #${oid}，购物车已清空"

echo
echo "✅ M19 验收冒烟全部通过"
