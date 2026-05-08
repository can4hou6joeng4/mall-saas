#!/usr/bin/env bash
# M13 验收冒烟：用 stripe-mock 跑 Stripe Provider 全链；CI smoke 已经在 GitHub Actions 里验
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m13-mock-secret-16chars}"
export STRIPE_API_KEY="${STRIPE_API_KEY:-sk_test_4eC39HqLyjWDarjtT1zdp7dcLOCAL}"
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_m13_acceptance}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m13-smoke"
STRIPE_MOCK="mall-stripe-mock-m13"
HOST_PORT="${HOST_PORT:-3013}"
STRIPE_MOCK_PORT="${STRIPE_MOCK_PORT:-12111}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9400}"
EMAIL="m13-acc@example.com"
PW="m13-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${STRIPE_MOCK}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step 1/7 "依赖容器存活 + 类型/lint/构建（不跑 docker e2e，由 acceptance 自身覆盖）"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm build

step 2/7 "拉起 stripe-mock 容器"
docker run -d --rm \
  --name "${STRIPE_MOCK}" \
  -p "${STRIPE_MOCK_PORT}:12111" \
  stripe/stripe-mock:latest >/dev/null
for i in $(seq 1 30); do
  if curl -sf -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer sk_test_dummy" \
    "http://127.0.0.1:${STRIPE_MOCK_PORT}/v1/payment_intents" -X GET >/dev/null 2>&1; then
    break
  fi
  sleep 1
  [[ "${i}" == "30" ]] && { echo "stripe-mock didn't come up"; exit 1; }
done

step 3/7 "构建镜像 + 起 mall-api（指 stripe-mock）"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm13-acc') ON CONFLICT (id) DO NOTHING;
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
  -e STRIPE_API_KEY="${STRIPE_API_KEY}" \
  -e STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET}" \
  -e STRIPE_API_HOST=host.docker.internal \
  -e STRIPE_API_PORT="${STRIPE_MOCK_PORT}" \
  -e STRIPE_API_PROTOCOL=http \
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

step 4/7 "注册 + 创建商品 + 下单"
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
access=$(echo "${reg}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${access}" -H 'content-type: application/json' \
  -d '{"name":"m13-sku","priceCents":3000,"stock":3}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

order=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${access}" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":${pid},\"quantity\":2}]}")
oid=$(echo "${order}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

step 5/7 "POST /orders/:id/pay provider=stripe → 通过 stripe-mock 拿 paymentIntent id"
pay=$(curl -s -o - -w '\nHTTP %{http_code}\n' -X POST "http://127.0.0.1:${HOST_PORT}/orders/${oid}/pay" \
  -H "authorization: Bearer ${access}" -H 'content-type: application/json' \
  -d '{"provider":"stripe"}')
echo "${pay}"
pref=$(echo "${pay}" | sed -n 's/.*"providerRef":"\([^"]*\)".*/\1/p' | head -1)
if [[ -z "${pref}" ]]; then
  echo ">>> stripe pay failed; mall-api logs (last 40):" >&2
  docker logs "${CONTAINER}" 2>&1 | tail -40 >&2
  exit 1
fi
echo "  ✓ Stripe PaymentIntent: ${pref}"

step 6/7 "构造 stripe-signature (t=,v1=) 并 POST /webhooks/payments/stripe"
body="{\"id\":\"evt_m13_$(date +%s)\",\"object\":\"event\",\"type\":\"payment_intent.succeeded\",\"data\":{\"object\":{\"id\":\"${pref}\"}}}"
ts=$(date +%s)
sig_payload="${ts}.${body}"
v1=$(printf '%s' "${sig_payload}" | openssl dgst -sha256 -hmac "${STRIPE_WEBHOOK_SECRET}" -hex | awk '{print $NF}')
header="t=${ts},v1=${v1}"

code=$(curl -s -o /tmp/m13-resp -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/stripe" \
  -H 'content-type: application/json' -H "stripe-signature: ${header}" \
  -d "${body}")
[[ "${code}" == "200" ]] || {
  echo "stripe webhook expected 200 got ${code}: $(cat /tmp/m13-resp)" >&2
  docker logs "${CONTAINER}" | tail -20 >&2
  exit 1
}

step 7/7 "断言 order.paid + stock 真扣 + reservedStock 归零"
read stock reserved <<< $(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT stock || ' ' || \"reservedStock\" FROM \"Product\" WHERE id = ${pid};")
[[ "${stock}" == "1" && "${reserved}" == "0" ]] || {
  echo "expected stock=1/reserved=0 got stock=${stock} reserved=${reserved}" >&2
  exit 1
}
status=$(docker exec -i mall-postgres psql -U mall -d mall -tAc \
  "SELECT status FROM \"Order\" WHERE id = ${oid};")
[[ "${status}" == "paid" ]] || { echo "expected status=paid got ${status}" >&2; exit 1; }
echo "  ✓ order=${oid} paid; product stock=${stock} reserved=${reserved}"

# 拒签验证：bad signature 必 401
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/webhooks/payments/stripe" \
  -H 'content-type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' \
  -d "${body}")
[[ "${code}" == "401" ]] || { echo "bad sig expected 401 got ${code}" >&2; exit 1; }
echo "  ✓ Stripe 验签拒绝错误签名"

echo
echo "✅ M13 验收冒烟全部通过"
