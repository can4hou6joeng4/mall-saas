#!/usr/bin/env bash
# M21 验收冒烟：商家后台体验完善
# - GET /store/orders/:id 单订单详情（含 user / coupon / payments）
# - POST /coupons + PATCH /coupons/:id/disable 优惠券生命周期
# - 全工作区 typecheck/lint/test/build（覆盖新增 store 单测）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m21-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m21-smoke"
HOST_PORT="${HOST_PORT:-3021}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9921}"
ADMIN="m21-admin@example.com"
USER="m21-user@example.com"
PW="m21-acc-pw!"
COUPON_CODE="M21SAVE"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/5 "全工作区 typecheck / lint / test / build"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/5 "构建镜像 + 启容器 + 准备租户"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm21-acc') ON CONFLICT (id) DO NOTHING;
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

step 3/5 "admin 注册 → 创建商品 → 创建优惠券"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m21-sku","priceCents":5000,"stock":20}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

cou=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/coupons" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d "{\"code\":\"${COUPON_CODE}\",\"discountType\":\"AMOUNT\",\"discountValue\":300,\"minOrderCents\":0,\"maxUsage\":0}")
cid=$(echo "${cou}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "${cou}" | grep -q "\"code\":\"${COUPON_CODE}\"" || { echo "coupon create failed: ${cou}" >&2; exit 1; }
echo "  ✓ 商品 #${pid} + 优惠券 #${cid} (${COUPON_CODE})"

step 4/5 "user 用 coupon 下单 → store 查 /store/orders/:id 看到 coupon"
user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
utoken=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

placed=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${pid},\"quantity\":1}],\"couponCode\":\"${COUPON_CODE}\"}")
oid=$(echo "${placed}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

detail=$(curl -sf "http://127.0.0.1:${HOST_PORT}/store/orders/${oid}" \
  -H "authorization: Bearer ${atoken}")
echo "${detail}" | grep -q "\"code\":\"${COUPON_CODE}\"" || { echo "store detail missing coupon: ${detail}" >&2; exit 1; }
echo "${detail}" | grep -q "\"email\":\"${USER}\"" || { echo "store detail missing user.email: ${detail}" >&2; exit 1; }
echo "${detail}" | grep -q "\"discountCents\":300" || { echo "store detail missing discount: ${detail}" >&2; exit 1; }
echo "  ✓ /store/orders/${oid} 含 coupon=${COUPON_CODE} + user.email + discount=300"

# 跨租户 404：用 admin token 访问一个不存在的订单
miss_code=$(curl -s -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:${HOST_PORT}/store/orders/999999" \
  -H "authorization: Bearer ${atoken}")
[[ "${miss_code}" == "404" ]] || { echo "expected 404 on missing order, got ${miss_code}" >&2; exit 1; }
echo "  ✓ 不存在的订单返回 404"

step 5/5 "PATCH /coupons/:id/disable → list 查到 status=disabled"
disabled=$(curl -sf -X PATCH "http://127.0.0.1:${HOST_PORT}/coupons/${cid}/disable" \
  -H "authorization: Bearer ${atoken}")
echo "${disabled}" | grep -q '"status":"disabled"' || { echo "coupon disable failed: ${disabled}" >&2; exit 1; }

list=$(curl -sf "http://127.0.0.1:${HOST_PORT}/coupons?status=disabled" \
  -H "authorization: Bearer ${atoken}")
echo "${list}" | grep -q "\"code\":\"${COUPON_CODE}\"" || { echo "disabled coupon missing in list: ${list}" >&2; exit 1; }
echo "  ✓ coupon ${COUPON_CODE} 已停用并出现在 status=disabled 列表"

echo
echo "✅ M21 验收冒烟全部通过"
