#!/usr/bin/env bash
# M23 验收冒烟：消费者 storefront 订单详情 + 支付闭环
# - 注册 user → admin 创建商品 → user 加购 → checkout (pending)
# - user 调起 /orders/:id/pay (mock)
# - 模拟 mock provider webhook 触发 succeeded
# - 重新查 /orders/:id 验证 status=paid
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m23-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m23-smoke"
HOST_PORT="${HOST_PORT:-3023}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9923}"
ADMIN="m23-admin@example.com"
USER="m23-user@example.com"
PW="m23-acc-pw!"

# CI 中可用 PSQL_CMD="psql -h 127.0.0.1 -U mall -d mall"（PGPASSWORD=mall）替换 docker exec
PSQL_CMD="${PSQL_CMD:-docker exec -i mall-postgres psql -U mall -d mall}"
SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/5 "全工作区 typecheck / lint / test / build（含 storefront 订单详情单测）"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 2/5 "构建镜像 + 启容器 + 准备租户"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
${PSQL_CMD} <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm23-acc') ON CONFLICT (id) DO NOTHING;
DELETE FROM "ProductImage" WHERE "tenantId" = ${TENANT_ID};
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

step 3/5 "admin 创建商品 + user 注册"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m23-sku","priceCents":4500,"stock":10}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
utoken=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

step 4/5 "user 加购 → checkout (pending) → POST /orders/:id/pay 拿到 providerRef"
curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/items" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d "{\"productId\":${pid},\"quantity\":1}" >/dev/null

co=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/checkout" \
  -H "authorization: Bearer ${utoken}")
oid=$(echo "${co}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "${co}" | grep -q '"status":"pending"' || { echo "expected pending: ${co}" >&2; exit 1; }
echo "  ✓ 订单 #${oid} 状态 pending"

pay=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders/${oid}/pay" \
  -H "authorization: Bearer ${utoken}" -H 'content-type: application/json' \
  -d '{"provider":"mock"}')
pref=$(echo "${pay}" | sed -n 's/.*"providerRef":"\([^"]*\)".*/\1/p')
[[ -n "${pref}" ]] || { echo "missing providerRef: ${pay}" >&2; exit 1; }
echo "${pay}" | grep -q '"status":"pending"' || { echo "payment not pending: ${pay}" >&2; exit 1; }
echo "  ✓ Payment 创建（providerRef=${pref}），等待 webhook 回调"

step 5/5 "mock webhook 触发 succeeded → /orders/:id status=paid"
body="{\"providerRef\":\"${pref}\",\"status\":\"succeeded\"}"
sig=$(printf '%s' "${body}" | openssl dgst -sha256 -hmac "${PAYMENT_MOCK_SECRET}" -hex | awk '{print $NF}')
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/mock" \
  -H 'content-type: application/json' -H "x-mock-signature: ${sig}" \
  -d "${body}")
[[ "${code}" == "200" ]] || { echo "webhook expected 200 got ${code}" >&2; exit 1; }

detail=$(curl -sf "http://127.0.0.1:${HOST_PORT}/orders/${oid}" \
  -H "authorization: Bearer ${utoken}")
echo "${detail}" | grep -q '"status":"paid"' || { echo "expected paid: ${detail}" >&2; exit 1; }
echo "  ✓ 订单 #${oid} 状态 paid（webhook → confirmIfPending 闭环）"

# 重复发送 webhook 必须仍 200（幂等）
code2=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/mock" \
  -H 'content-type: application/json' -H "x-mock-signature: ${sig}" \
  -d "${body}")
[[ "${code2}" == "200" ]] || { echo "webhook re-delivery expected 200 got ${code2}" >&2; exit 1; }
echo "  ✓ webhook 幂等：重复回调仍 200"

echo
echo "✅ M23 验收冒烟全部通过"
