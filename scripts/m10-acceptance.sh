#!/usr/bin/env bash
# M10 验收冒烟：refresh token 旋转 + logout 撤销 + 密码重置 + 敏感端点限流
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-900}"
export JWT_REFRESH_TTL_SECONDS="${JWT_REFRESH_TTL_SECONDS:-604800}"
export PASSWORD_RESET_TTL_SECONDS="${PASSWORD_RESET_TTL_SECONDS:-600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m10-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m10-smoke"
HOST_PORT="${HOST_PORT:-3010}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9100}"
EMAIL="m10-acc@example.com"
PW="m10-acc-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/8 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/8 "应用 Prisma 迁移 + generate + 类型/lint/测试/构建"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build

step 3/8 "构建镜像"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"

step 4/8 "启动容器（AUTH_RATE_LIMIT_MAX=4 便于触发 429）"
docker exec -i mall-postgres psql -U mall -d mall <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (${TENANT_ID}, 'm10-acc') ON CONFLICT (id) DO NOTHING;
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
  -e JWT_TTL_SECONDS=900 \
  -e JWT_REFRESH_TTL_SECONDS=604800 \
  -e PASSWORD_RESET_TTL_SECONDS=600 \
  -e PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET}" \
  -e PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL}" \
  -e PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD}" \
  -e ORDER_TIMEOUT_MS=1800000 \
  -e RATE_LIMIT_MAX=200 \
  -e RATE_LIMIT_WINDOW="1 minute" \
  -e AUTH_RATE_LIMIT_MAX=4 \
  -e AUTH_RATE_LIMIT_WINDOW_SEC=60 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "container exited:" >&2; docker logs "${CONTAINER}" >&2; exit 1
  fi
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout waiting healthz" >&2; docker logs "${CONTAINER}" >&2; exit 1; }
done

# 清掉历史 rate-limit 计数（容器已连同一 redis）
docker exec mall-redis redis-cli --scan --pattern 'ratelimit:auth:*' | xargs -r docker exec mall-redis redis-cli del >/dev/null

step 5/8 "注册 → 拿 access + refresh"
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\",\"password\":\"${PW}\"}")
access=$(echo "${reg}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
refresh=$(echo "${reg}" | sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p')
[[ -n "${access}" && -n "${refresh}" ]] || { echo "register lacked tokens" >&2; exit 1; }

echo "-- access token 调 /products 应 200"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${access}")
[[ "${code}" == "200" ]] || { echo "expected 200 got ${code}" >&2; exit 1; }

echo "-- refresh token 不能直接调业务路由（应 401）"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${refresh}")
[[ "${code}" == "401" ]] || { echo "refresh token misuse expected 401 got ${code}" >&2; exit 1; }

step 6/8 "refresh 旋转 + logout 撤销"
new=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"${refresh}\"}")
new_refresh=$(echo "${new}" | sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p')
[[ -n "${new_refresh}" && "${new_refresh}" != "${refresh}" ]] || {
  echo "refresh did not rotate: ${new}" >&2; exit 1
}

echo "-- 老 refresh 二次使用应 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/refresh" \
  -H 'content-type: application/json' -d "{\"refreshToken\":\"${refresh}\"}")
[[ "${code}" == "401" ]] || { echo "stale refresh expected 401 got ${code}" >&2; exit 1; }

echo "-- logout 撤销新 refresh"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/logout" \
  -H 'content-type: application/json' -d "{\"refreshToken\":\"${new_refresh}\"}")
[[ "${code}" == "204" ]] || { echo "logout expected 204 got ${code}" >&2; exit 1; }

echo "-- 撤销后再 refresh 应 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/refresh" \
  -H 'content-type: application/json' -d "{\"refreshToken\":\"${new_refresh}\"}")
[[ "${code}" == "401" ]] || { echo "post-logout refresh expected 401 got ${code}" >&2; exit 1; }

step 7/8 "密码重置：申请 → 确认 → 新密码登录"
docker exec mall-redis redis-cli --scan --pattern 'ratelimit:auth:*' | xargs -r docker exec mall-redis redis-cli del >/dev/null
req=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/password-reset/request" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\"}")
reset=$(echo "${req}" | sed -n 's/.*"resetToken":"\([^"]*\)".*/\1/p')
[[ -n "${reset}" ]] || { echo "no resetToken: ${req}" >&2; exit 1; }

new_pw="m10-acc-newpw!"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/password-reset/confirm" \
  -H 'content-type: application/json' \
  -d "{\"resetToken\":\"${reset}\",\"newPassword\":\"${new_pw}\"}")
[[ "${code}" == "200" ]] || { echo "confirm expected 200 got ${code}" >&2; exit 1; }

# 老密码应失败
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\",\"password\":\"${PW}\"}")
[[ "${code}" == "401" ]] || { echo "old password expected 401 got ${code}" >&2; exit 1; }

# 新密码应成功
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${EMAIL}\",\"password\":\"${new_pw}\"}")
[[ "${code}" == "200" ]] || { echo "new password expected 200 got ${code}" >&2; exit 1; }

step 8/8 "敏感端点限流：连续 6 次错密码登录至少触发一次 429"
docker exec mall-redis redis-cli --scan --pattern 'ratelimit:auth:*' | xargs -r docker exec mall-redis redis-cli del >/dev/null
hit_429=0
for i in $(seq 1 8); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"tenantId\":${TENANT_ID},\"email\":\"never@${TENANT_ID}.dev\",\"password\":\"x\"}")
  if [[ "${c}" == "429" ]]; then hit_429=1; break; fi
done
[[ "${hit_429}" == "1" ]] || { echo "did not hit 429 within 8 attempts" >&2; exit 1; }

echo
echo "✅ M10 验收冒烟全部通过"
