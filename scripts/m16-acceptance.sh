#!/usr/bin/env bash
# M16 验收冒烟：上传商品图片 → curl /uploads/* 拿到 200 → DELETE → 列表归零
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m16-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m16-smoke"
HOST_PORT="${HOST_PORT:-3016}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9700}"
ADMIN="m16-admin@example.com"
PW="m16-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/5 "依赖容器 + 测试 + 构建"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/5 "构建镜像 + 启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm16-acc') ON CONFLICT (id) DO NOTHING;
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
  -e STORAGE_LOCAL_DIR=/tmp/mall-uploads-m16 \
  -e STORAGE_PUBLIC_BASE=/uploads \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout"; docker logs "${CONTAINER}"; exit 1; }
done

step 3/5 "admin 注册 + 创建商品"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
atoken=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

prod=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${atoken}" -H 'content-type: application/json' \
  -d '{"name":"m16-sku","priceCents":100,"stock":1}')
pid=$(echo "${prod}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)

step 4/5 "上传 1x1 png 图片 → 列出 → curl /uploads/* 200"
# 1x1 transparent PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x9aR\xc7]\x00\x00\x00\x00IEND\xaeB`\x82' > /tmp/m16-pixel.png

upload=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/products/${pid}/images" \
  -H "authorization: Bearer ${atoken}" \
  -F "file=@/tmp/m16-pixel.png;type=image/png")
img_id=$(echo "${upload}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
img_url=$(echo "${upload}" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
echo "  ✓ uploaded id=${img_id} url=${img_url}"

list=$(curl -sf "http://127.0.0.1:${HOST_PORT}/products/${pid}/images" \
  -H "authorization: Bearer ${atoken}")
echo "${list}" | grep -q "\"id\":${img_id}" || { echo "list missing image: ${list}" >&2; exit 1; }

# 拉取静态文件
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}${img_url}")
[[ "${code}" == "200" ]] || { echo "static fetch expected 200 got ${code}" >&2; exit 1; }
echo "  ✓ /uploads/* 静态返回 200"

step 5/5 "DELETE /images/:id → 列表清零"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "http://127.0.0.1:${HOST_PORT}/images/${img_id}" \
  -H "authorization: Bearer ${atoken}")
[[ "${code}" == "204" ]] || { echo "delete expected 204 got ${code}" >&2; exit 1; }
after=$(curl -sf "http://127.0.0.1:${HOST_PORT}/products/${pid}/images" \
  -H "authorization: Bearer ${atoken}")
[[ "${after}" == "[]" ]] || { echo "expected empty list got ${after}" >&2; exit 1; }

echo
echo "✅ M16 验收冒烟全部通过"
