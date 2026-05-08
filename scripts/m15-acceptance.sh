#!/usr/bin/env bash
# M15 验收冒烟：优惠券创建 → 下单应用折扣 → maxUsage 上限触发 409
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m15-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m15-smoke"
HOST_PORT="${HOST_PORT:-3015}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9600}"
ADMIN="m15-admin@example.com"
USER="m15-user@example.com"
PW="m15-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/6 "依赖容器 + 测试 + 构建"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/6 "构建镜像 + 启容器 + 清表"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm15-acc') ON CONFLICT (id) DO NOTHING;
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

step 3/6 "admin 注册 + 创建商品 + 创建优惠券（PERCENT 20%, maxUsage=1）"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m15-sku","priceCents":5000,"stock":5}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/coupons" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"code":"M15-OFF","discountType":"PERCENT","discountValue":20,"maxUsage":1}' >/dev/null

step 4/6 "user 注册 + 用 coupon 下单 → 验证 totalCents=8000（10000 - 20%）"
user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
utoken=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

order=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${pid},\"quantity\":2}],\"couponCode\":\"M15-OFF\"}")
sub=$(echo "${order}" | sed -n 's/.*"subtotalCents":\([0-9]*\).*/\1/p' | head -1)
disc=$(echo "${order}" | sed -n 's/.*"discountCents":\([0-9]*\).*/\1/p' | head -1)
total=$(echo "${order}" | sed -n 's/.*"totalCents":\([0-9]*\).*/\1/p' | head -1)
[[ "${sub}" == "10000" && "${disc}" == "2000" && "${total}" == "8000" ]] || {
  echo "expected sub=10000/disc=2000/total=8000 got sub=${sub}/disc=${disc}/total=${total}" >&2
  echo "order body: ${order}" >&2
  exit 1
}
echo "  ✓ subtotal=${sub} discount=${disc} total=${total}"

step 5/6 "再用同一 coupon 下单应 409（maxUsage=1 超限）"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${pid},\"quantity\":1}],\"couponCode\":\"M15-OFF\"}")
[[ "${code}" == "409" ]] || { echo "expected 409 got ${code}" >&2; exit 1; }
echo "  ✓ maxUsage 上限触发 409"

step 6/6 "DB 校验 coupon usageCount=1"
usage=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT \"usageCount\" FROM \"Coupon\" WHERE \"tenantId\" = ${TENANT_ID} AND code = 'M15-OFF';")
[[ "${usage}" == "1" ]] || { echo "expected usageCount=1 got '${usage}'" >&2; exit 1; }
echo "  ✓ Coupon usageCount=${usage}"

echo
echo "✅ M15 验收冒烟全部通过"
