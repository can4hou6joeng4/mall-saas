#!/usr/bin/env bash
# M29 验收冒烟：admin 一次性临时密码重置
# - register user → 旧密码 login 200 → admin reset → 旧密码 401 → temporaryPassword 200
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m29-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m29-smoke"
HOST_PORT="${HOST_PORT:-3029}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9929}"
USER="m29-user@example.com"
OLD_PW="m29-old-pw-1234!"

PSQL_CMD="${PSQL_CMD:-docker exec -i mall-postgres psql -U mall -d mall}"
SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（含 admin reset jsdom 单测）"
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
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm29-acc')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
DELETE FROM "CartItem" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${TENANT_ID});
DELETE FROM "Order" WHERE "tenantId" = ${TENANT_ID};
DELETE FROM "User" WHERE "tenantId" = ${TENANT_ID};
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

step 3/4 "register user + 旧密码 login 200 → admin reset 拿到 temporaryPassword"
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${OLD_PW}\"}")
uid=$(echo "${reg}" | sed -n 's/.*"user":{"id":\([0-9]*\).*/\1/p' | head -1)

# 旧密码 login 200 baseline
code0=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${OLD_PW}\"}")
[[ "${code0}" == "200" ]] || { echo "baseline login expected 200 got ${code0}" >&2; exit 1; }

plat=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${PLATFORM_ADMIN_EMAIL}\",\"password\":\"${PLATFORM_ADMIN_PASSWORD}\"}")
ptoken=$(echo "${plat}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

reset=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/users/${uid}/reset-password" \
  -H "authorization: Bearer ${ptoken}")
tmp_pw=$(echo "${reset}" | sed -n 's/.*"temporaryPassword":"\([^"]*\)".*/\1/p')
[[ -n "${tmp_pw}" ]] || { echo "missing temporaryPassword: ${reset}" >&2; exit 1; }
echo "  ✓ admin 重置 user #${uid}，拿到一次性临时密码（长度 ${#tmp_pw}）"

step 4/4 "旧密码 401 + 新临时密码 200"
code1=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${OLD_PW}\"}")
[[ "${code1}" == "401" ]] || { echo "old password should fail, got ${code1}" >&2; exit 1; }
echo "  ✓ 旧密码 login 返回 401"

code2=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER}\",\"password\":\"${tmp_pw}\"}")
[[ "${code2}" == "200" ]] || { echo "temp password should work, got ${code2}" >&2; exit 1; }
echo "  ✓ 新临时密码 login 返回 200"

# 不存在的 user → 404
code3=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/admin/users/999999/reset-password" \
  -H "authorization: Bearer ${ptoken}")
[[ "${code3}" == "404" ]] || { echo "expected 404 got ${code3}" >&2; exit 1; }
echo "  ✓ 不存在的 user reset 返回 404"

echo
echo "✅ M29 验收冒烟全部通过"
