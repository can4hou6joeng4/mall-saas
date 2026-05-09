#!/usr/bin/env bash
# M12 验收冒烟：购物车 + 预占语义全链：加购物车 → checkout → 验证 reservedStock + stock 不变 → 支付成功 → stock 真扣 reservedStock 释放
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m12-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m12-smoke"
HOST_PORT="${HOST_PORT:-3012}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9300}"
EMAIL="m12-acc@example.com"
PW="m12-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/7 "依赖容器 + 测试 + 构建"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/7 "构建镜像 + 启容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm12-acc') ON CONFLICT (id) DO NOTHING;
DELETE FROM "CartItem" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Payment" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "Product" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "User" WHERE "tenantId" = ${TENANT_ID};
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

step 3/7 "注册 admin/user + 创建 stock=5 的商品"
admin=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"admin-${EMAIL}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
admin_token=$(echo "${admin}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

user=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\",\"password\":\"${PW}\"}")
user_token=$(echo "${user}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${admin_token}" -H 'content-type: application/json' \
  -d '{"name":"m12-sku","priceCents":2000,"stock":5}')
prod_id=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

step 4/7 "加购物车 + 列出"
curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/items" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d "{\"productId\":${prod_id},\"quantity\":3}" >/dev/null

cart=$(curl -sf "http://127.0.0.1:${HOST_PORT}/cart" -H "authorization: Bearer ${user_token}")
echo "${cart}" | grep -q "\"productId\":${prod_id}" || { echo "cart missing product: ${cart}" >&2; exit 1; }

step 5/7 "checkout → pending order，stock=5 不变，reservedStock=3"
checkout=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/checkout" \
  -H "authorization: Bearer ${user_token}")
order_id=$(echo "${checkout}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

read -r stock reserved < <(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT stock || ' ' || \"reservedStock\" FROM \"Product\" WHERE id = ${prod_id};")
[[ "${stock}" == "5" && "${reserved}" == "3" ]] || {
  echo "after checkout expected stock=5/reserved=3 got stock=${stock} reserved=${reserved}" >&2
  exit 1
}
echo "  ✓ stock=${stock} reservedStock=${reserved}"

# checkout 后购物车应清空
cart=$(curl -sf "http://127.0.0.1:${HOST_PORT}/cart" -H "authorization: Bearer ${user_token}")
[[ "${cart}" == "[]" ]] || { echo "cart not cleared: ${cart}" >&2; exit 1; }

step 6/7 "支付 + 签名 webhook → order.paid，stock 真扣到 2 且 reservedStock 归零"
pay=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders/${order_id}/pay" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d '{"provider":"mock"}')
pref=$(echo "${pay}" | sed -n 's/.*"providerRef":"\([^"]*\)".*/\1/p')

body="{\"providerRef\":\"${pref}\",\"status\":\"succeeded\"}"
sig=$(printf '%s' "${body}" | openssl dgst -sha256 -hmac "${PAYMENT_MOCK_SECRET}" -hex | awk '{print $NF}')
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/mock" \
  -H 'content-type: application/json' -H "x-mock-signature: ${sig}" \
  -d "${body}")
[[ "${code}" == "200" ]] || { echo "webhook expected 200 got ${code}" >&2; exit 1; }

read -r stock reserved < <(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT stock || ' ' || \"reservedStock\" FROM \"Product\" WHERE id = ${prod_id};")
[[ "${stock}" == "2" && "${reserved}" == "0" ]] || {
  echo "after paid expected stock=2/reserved=0 got stock=${stock} reserved=${reserved}" >&2
  exit 1
}
echo "  ✓ stock=${stock} reservedStock=${reserved}"

status=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT status FROM \"Order\" WHERE id = ${order_id};")
[[ "${status}" == "paid" ]] || { echo "expected status=paid got ${status}" >&2; exit 1; }

step 7/7 "再下一笔并主动取消 → reservedStock 应释放回 0"
curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/items" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d "{\"productId\":${prod_id},\"quantity\":2}" >/dev/null
checkout=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/cart/checkout" -H "authorization: Bearer ${user_token}")
order2=$(echo "${checkout}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders/${order2}/cancel" \
  -H "authorization: Bearer ${user_token}" >/dev/null

read -r stock reserved < <(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT stock || ' ' || \"reservedStock\" FROM \"Product\" WHERE id = ${prod_id};")
[[ "${stock}" == "2" && "${reserved}" == "0" ]] || {
  echo "after cancel expected stock=2/reserved=0 got stock=${stock} reserved=${reserved}" >&2
  exit 1
}
echo "  ✓ 取消后 stock=${stock} reservedStock=${reserved}"

echo
echo "✅ M12 验收冒烟全部通过"
