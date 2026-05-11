#!/usr/bin/env bash
# M17 验收冒烟：同一业务错误用 Accept-Language=en 与 zh-CN 各调一次，message 不同
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m17-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m17-smoke"
HOST_PORT="${HOST_PORT:-3017}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9800}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "依赖容器 + 测试 + 构建"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/4 "构建镜像 + 启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm17-acc') ON CONFLICT (id) DO NOTHING;
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
  -e STORAGE_LOCAL_DIR=/tmp/mall-uploads-m17 \
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

step 3/4 "注册 + 拿 token"
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"m17@acc.dev\",\"password\":\"m17-acc-pw!\",\"role\":\"admin\"}")
token=$(echo "${reg}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

step 4/4 "GET /products/999999 各用 en / zh-CN 调用，验证 message 不同"
en_msg=$(curl -s -X GET "http://127.0.0.1:${HOST_PORT}/products/999999" \
  -H "authorization: Bearer ${token}" -H 'accept-language: en' | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
zh_msg=$(curl -s -X GET "http://127.0.0.1:${HOST_PORT}/products/999999" \
  -H "authorization: Bearer ${token}" -H 'accept-language: zh-CN,zh;q=0.9' | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')

echo "  en: ${en_msg}"
echo "  zh: ${zh_msg}"

[[ "${en_msg}" == "Product 999999 not found" ]] || { echo "en mismatch" >&2; exit 1; }
[[ "${zh_msg}" == "商品 999999 不存在" ]] || { echo "zh mismatch" >&2; exit 1; }
[[ "${en_msg}" != "${zh_msg}" ]] || { echo "en == zh, i18n not switching" >&2; exit 1; }

echo
echo "✅ M17 验收冒烟全部通过"
