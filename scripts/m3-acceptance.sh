#!/usr/bin/env bash
# M3 验收冒烟：在 M2 基础上叠加 注册 → 登录 → JWT 访问商品 全链路
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m3-smoke"
HOST_PORT="${HOST_PORT:-3003}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
TENANT_ID="${TENANT_ID:-9001}"
ADMIN_EMAIL="m3-admin@example.com"
USER_EMAIL="m3-user@example.com"
PASSWORD="m3-acceptance-pw!"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/8 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/8 "应用 Prisma 迁移"
pnpm --filter @mall/api exec prisma migrate deploy

step 3/8 "类型检查 / Lint"
pnpm typecheck
pnpm lint

step 4/8 "运行所有测试（含 auth / 角色 / RLS / 商品 / 错误形状）"
pnpm test

step 5/8 "构建所有包"
pnpm build

step 6/8 "构建镜像并启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e JWT_TTL_SECONDS="${JWT_TTL_SECONDS}" \
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
  [[ "${i}" == "40" ]] && { echo "timeout" >&2; docker logs "${CONTAINER}" >&2; exit 1; }
done

step 7/8 "准备 acceptance 用租户（用超管账号 upsert）"
docker exec -i mall-postgres psql -U mall -d mall -c \
  "INSERT INTO \"Tenant\" (id, name) VALUES (${TENANT_ID}, 'acceptance') ON CONFLICT (id) DO NOTHING;" \
  >/dev/null
docker exec -i mall-postgres psql -U mall -d mall -c \
  "DELETE FROM \"User\" WHERE \"tenantId\" = ${TENANT_ID};" >/dev/null
docker exec -i mall-postgres psql -U mall -d mall -c \
  "DELETE FROM \"Product\" WHERE \"tenantId\" = ${TENANT_ID};" >/dev/null

step 8/8 "Auth + 角色 + 商品全链路"

echo "-- 注册 admin"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${PASSWORD}\",\"role\":\"admin\"}")
admin_token=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "${admin_token}" ]] || { echo "register admin failed: ${admin_resp}" >&2; exit 1; }

echo "-- 注册普通 user"
user_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":${TENANT_ID},\"email\":\"${USER_EMAIL}\",\"password\":\"${PASSWORD}\",\"role\":\"user\"}")
user_token=$(echo "${user_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "${user_token}" ]] || { echo "register user failed: ${user_resp}" >&2; exit 1; }

echo "-- 无 token 访问 /products 应 401"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/products")
[[ "${code}" == "401" ]] || { echo "expected 401 got ${code}" >&2; exit 1; }

echo "-- admin POST /products 应 201"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${admin_token}" -H 'content-type: application/json' \
  -d '{"name":"acceptance-sku","priceCents":1234,"stock":1}')
[[ "${code}" == "201" ]] || { echo "admin POST expected 201 got ${code}" >&2; exit 1; }

echo "-- user POST /products 应 403"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${user_token}" -H 'content-type: application/json' \
  -d '{"name":"forbidden","priceCents":1}')
[[ "${code}" == "403" ]] || { echo "user POST expected 403 got ${code}" >&2; exit 1; }

echo "-- user GET /products 应 200"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/products" \
  -H "authorization: Bearer ${user_token}")
[[ "${code}" == "200" ]] || { echo "user GET expected 200 got ${code}" >&2; exit 1; }

echo
echo "✅ M3 验收冒烟全部通过"
