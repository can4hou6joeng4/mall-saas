#!/usr/bin/env bash
# M31 验收冒烟：storefront 结账接 couponCode 拉通到消费者侧
# - admin 创建商品 + 优惠券 → user 加购 → POST /cart/checkout {couponCode} →
#   GET /orders/:id 验证 discountCents>0 + couponId 非 null
# - 不存在券 → 404 + cart 不被清空
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m31-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m31-smoke"
HOST_PORT="${HOST_PORT:-3031}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9931}"
ADMIN="m31-admin@example.com"
USER="m31-user@example.com"
PW="m31-acc-pw!"
COUPON_CODE="M31SAVE_$(date +%s)"

PSQL_CMD="${PSQL_CMD:-docker exec -i mall-postgres psql -U mall -d mall}"
SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（含 storefront cart-page jsdom 单测）"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 2/4 "构建镜像 + 启容器 + 准备租户"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
${PSQL_CMD} <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm31-acc')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
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

step 3/4 "造数据：admin 商品 + AMOUNT 200 券；user 加购 → /cart/checkout 带券"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m31-sku","priceCents":3000,"stock":10}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/coupons" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d "{\"code\":\"${COUPON_CODE}\",\"discountType\":\"AMOUNT\",\"discountValue\":200,\"minOrderCents\":0,\"maxUsage\":0}" >/dev/null

user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
utoken=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/items" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"productId\":${pid},\"quantity\":1}" >/dev/null

co=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/checkout" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"couponCode\":\"${COUPON_CODE}\"}")
oid=$(echo "${co}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "${co}" | grep -q '"discountCents":200' || { echo "expected discount=200: ${co}" >&2; exit 1; }
echo "${co}" | grep -q '"couponId":[0-9]' || { echo "missing couponId: ${co}" >&2; exit 1; }
echo "  ✓ /cart/checkout 带券生效：order #${oid} discount=200"

step 4/4 "GET /orders/:id 复核 + 不存在券 → 404 + cart 保留"
detail=$(curl -sf "http://127.0.0.1:${HOST_PORT}/orders/${oid}" \
  -H "authorization: Bearer ${utoken}")
echo "${detail}" | grep -q '"discountCents":200' || { echo "detail missing discount: ${detail}" >&2; exit 1; }
echo "  ✓ /orders/${oid} 详情 discount=200"

# 再加购 + 用不存在的券 → 404
curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/items" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"productId\":${pid},\"quantity\":1}" >/dev/null

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/cart/checkout" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d '{"couponCode":"TOTALLY_BOGUS"}')
[[ "${code}" == "404" ]] || { echo "expected 404 on bad coupon got ${code}" >&2; exit 1; }

cart=$(curl -sf "http://127.0.0.1:${HOST_PORT}/cart" -H "authorization: Bearer ${utoken}")
[[ "${cart}" != "[]" ]] || { echo "cart should NOT be cleared on coupon error" >&2; exit 1; }
echo "  ✓ 不存在的券 → 404 + cart 保留（购物车没被清空）"

echo
echo "✅ M31 验收冒烟全部通过"
