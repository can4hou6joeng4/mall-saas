#!/usr/bin/env bash
# M26 验收冒烟：admin tenant 详情聚合
# - platform admin 登录 → 创建租户 → 在租户内造数据（admin/user/product/order）
# - GET /admin/tenants/:id 验证 productCount/userCount/ordersByStatus/paidRevenueCents
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m26-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m26-smoke"
HOST_PORT="${HOST_PORT:-3026}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9926}"
ADMIN="m26-admin@example.com"
USER="m26-user@example.com"
PW="m26-acc-pw!"

PSQL_CMD="${PSQL_CMD:-docker exec -i mall-postgres psql -U mall -d mall}"
SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（含 admin tenant-detail jsdom 单测）"
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
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm26-acc') ON CONFLICT (id) DO NOTHING;
DELETE FROM "ProductImage" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "CartItem" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Payment" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "User" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Product" WHERE "tenantId" = ${TENANT_ID};
-- 清空 PlatformAdmin 让容器 bootstrap 重建（PLATFORM_ADMIN_EMAIL/PASSWORD 用本脚本默认值）
DELETE FROM "PlatformAdmin";
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

step 3/4 "造数据：tenant.admin 注册 + 创建商品 + tenant.user 下单"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m26-sku","priceCents":2500,"stock":5}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
utoken=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${pid},\"quantity\":2}]}" >/dev/null
echo "  ✓ 商品 #${pid} + admin/user 注册 + 1 个 pending 订单"

step 4/4 "platform admin 登录 → GET /admin/tenants/:id 聚合数据校验"
plat=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${PLATFORM_ADMIN_EMAIL}\",\"password\":\"${PLATFORM_ADMIN_PASSWORD}\"}")
ptoken=$(echo "${plat}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "${ptoken}" ]] || { echo "platform login failed: ${plat}" >&2; exit 1; }

detail=$(curl -sf "http://127.0.0.1:${HOST_PORT}/admin/tenants/${TENANT_ID}" \
  -H "authorization: Bearer ${ptoken}")
echo "${detail}" | grep -q "\"id\":${TENANT_ID}" || { echo "missing id: ${detail}" >&2; exit 1; }
echo "${detail}" | grep -q "\"productCount\":1" || { echo "expected productCount=1: ${detail}" >&2; exit 1; }
echo "${detail}" | grep -q "\"userCount\":2" || { echo "expected userCount=2: ${detail}" >&2; exit 1; }
echo "${detail}" | grep -q "\"pending\":{\"count\":1" || { echo "expected pending count=1: ${detail}" >&2; exit 1; }
echo "${detail}" | grep -q "\"paidRevenueCents\":0" || { echo "expected paidRevenue=0: ${detail}" >&2; exit 1; }
echo "  ✓ /admin/tenants/${TENANT_ID} → product=1 user=2 pending=1 paidRevenue=0"

# 不存在的 tenant 应 404
code=$(curl -s -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:${HOST_PORT}/admin/tenants/999999" \
  -H "authorization: Bearer ${ptoken}")
[[ "${code}" == "404" ]] || { echo "expected 404 got ${code}" >&2; exit 1; }
echo "  ✓ 不存在的 tenant 返回 404"

echo
echo "✅ M26 验收冒烟全部通过"
