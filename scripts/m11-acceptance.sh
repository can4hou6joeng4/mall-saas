#!/usr/bin/env bash
# M11 验收冒烟：通过容器日志验证 prisma 事务日志带 traceId + tenantId
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m11-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m11-smoke"
HOST_PORT="${HOST_PORT:-3011}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9200}"
EMAIL="m11-acc@example.com"
PW="m11-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/6 "依赖容器存活 + 测试 + 构建"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/6 "构建镜像"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"

step 3/6 "起容器（LOG_LEVEL=debug 便于看到事务日志）"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm11-acc') ON CONFLICT (id) DO NOTHING;
DELETE FROM "Payment" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
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
  -e LOG_LEVEL=debug \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout"; docker logs "${CONTAINER}"; exit 1; }
done

step 4/6 "注册 → 用 access token 命中 /products（触发一次 prisma 事务）"
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\",\"password\":\"${PW}\",\"role\":\"admin\"}")
access=$(echo "${reg}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "${access}" ]] || { echo "no token in: ${reg}" >&2; exit 1; }

own_trace="m11-trace-$(date +%s)"
curl -sf -H "authorization: Bearer ${access}" -H "x-request-id: ${own_trace}" \
  "http://127.0.0.1:${HOST_PORT}/products" >/dev/null

step 5/6 "从容器日志中找出 phase=tx-commit 且含上一步 traceId + tenantId 的记录"
sleep 1
logs=$(docker logs "${CONTAINER}" 2>&1)
match=$(echo "${logs}" | grep -F 'tx-commit' | grep -F "\"traceId\":\"${own_trace}\"" | grep -F "\"tenantId\":${TENANT_ID}" || true)
if [[ -z "${match}" ]]; then
  echo "未在日志中找到符合条件的事务记录" >&2
  echo "----- 最近 20 条 tx-commit 日志 -----" >&2
  echo "${logs}" | grep -F 'tx-commit' | tail -20 >&2
  exit 1
fi
echo "  ✓ 命中事务日志："
echo "${match}" | head -3

step 6/6 "确认 /metrics 端点把这次请求计入"
metrics=$(curl -sf "http://127.0.0.1:${HOST_PORT}/metrics")
echo "${metrics}" | grep 'http_requests_total' | head -3

echo
echo "✅ M11 验收冒烟全部通过"
