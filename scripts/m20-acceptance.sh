#!/usr/bin/env bash
# M20 验收冒烟：三前端 401→refresh 自动续期
# - 全工作区 typecheck/lint/test/build（覆盖新增 refresh-token jsdom 单测）
# - 后端 /auth/refresh 端到端：旋转后老 refreshToken 失效
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m20-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m20-smoke"
HOST_PORT="${HOST_PORT:-3020}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9920}"
USER="m20-user@example.com"
PW="m20-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（含 store refresh-token jsdom 单测）"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/4 "构建镜像 + 启容器 + 准备租户"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm20-acc') ON CONFLICT (id) DO NOTHING;
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

step 3/4 "register → 拿 access+refresh → 用 access 访问 protected 200"
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${PW}\"}")
at1=$(echo "${reg}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
rt1=$(echo "${reg}" | sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p')
[[ -n "${at1}" && -n "${rt1}" ]] || { echo "missing tokens in register: ${reg}" >&2; exit 1; }

curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${at1}"
echo "  ✓ at1 可正常调用 /orders"

step 4/4 "/auth/refresh 旋转：新 token 可用 + 老 refreshToken 立即失效"
ref=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"${rt1}\"}")
at2=$(echo "${ref}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
rt2=$(echo "${ref}" | sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p')
[[ -n "${at2}" && -n "${rt2}" ]] || { echo "missing tokens after refresh: ${ref}" >&2; exit 1; }
# accessToken 不带 jti，同秒同 payload 会得到完全相同字节串，因此只断言 refreshToken 旋转
[[ "${rt2}" != "${rt1}" ]] || { echo "refreshToken did not rotate" >&2; exit 1; }

curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/orders" \
  -H "authorization: Bearer ${at2}"
echo "  ✓ at2（新 access）可正常调用 /orders"

# 老 refreshToken 复用：必须 401（whitelist 已切换到 rt2）
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:${HOST_PORT}/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"${rt1}\"}")
[[ "${code}" == "401" ]] || { echo "expected 401 on old refresh, got ${code}" >&2; exit 1; }
echo "  ✓ 老 refreshToken 已被 rt2 顶替，复用返回 401"

echo
echo "✅ M20 验收冒烟全部通过"
