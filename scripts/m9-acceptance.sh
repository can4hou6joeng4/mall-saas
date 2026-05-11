#!/usr/bin/env bash
# M9 验收冒烟：admin 工作区构建 + 类型生成 + 端到端通过 admin client 行为模拟
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m9-mock-secret-16-chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m9-smoke"
HOST_PORT="${HOST_PORT:-3009}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/7 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/7 "应用 Prisma 迁移 + 生成 client"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate

step 3/7 "类型检查 / Lint / 测试 / 构建（含 admin 工作区）"
pnpm typecheck
pnpm lint
pnpm test
pnpm build

step 4/7 "用 openapi.json 重新生成 admin 类型，确保契约一致"
pnpm --filter @mall/api openapi:gen
pnpm --filter @mall/admin openapi:types
if git diff --quiet apps/admin/src/api/types.gen.ts; then
  echo "  ✓ admin 类型与最新 openapi.json 完全一致"
else
  echo "admin types.gen.ts 与 openapi.json 不一致，请重新生成并提交" >&2
  exit 1
fi

step 5/7 "构建 api 镜像并起容器"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
# 清掉历史 platform admin 让 bootstrap 重建
docker exec -i mall-postgres psql -U mall -d mall -c 'DELETE FROM "PlatformAdmin";' >/dev/null

docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e JWT_TTL_SECONDS="${JWT_TTL_SECONDS}" \
  -e PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET}" \
  -e PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL}" \
  -e PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD}" \
  -e ORDER_TIMEOUT_MS=1800000 \
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

step 6/7 "模拟 admin client：登录 → 列出 tenants → 创建 tenant → 再次列出"
admin_resp=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${PLATFORM_ADMIN_EMAIL}\",\"password\":\"${PLATFORM_ADMIN_PASSWORD}\"}")
admin_token=$(echo "${admin_resp}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "${admin_token}" ]] || { echo "admin login failed" >&2; exit 1; }

initial=$(curl -sf "http://127.0.0.1:${HOST_PORT}/admin/tenants" -H "authorization: Bearer ${admin_token}")
echo "${initial}" | grep -q '\[' || { echo "tenants list not array: ${initial}" >&2; exit 1; }

create=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/admin/tenants" \
  -H "authorization: Bearer ${admin_token}" -H 'content-type: application/json' \
  -d '{"name":"m9-frontend-acceptance"}')
echo "${create}" | grep -q 'm9-frontend-acceptance' || {
  echo "create tenant body unexpected: ${create}" >&2; exit 1
}

after=$(curl -sf "http://127.0.0.1:${HOST_PORT}/admin/tenants" -H "authorization: Bearer ${admin_token}")
echo "${after}" | grep -q 'm9-frontend-acceptance' || {
  echo "tenant not in re-list: ${after}" >&2; exit 1
}

step 7/7 "admin 静态产物可由任意静态服务器投放（产物体积 + index.html 检查）"
[[ -f "${ROOT}/apps/admin/dist/index.html" ]] || { echo "missing dist/index.html" >&2; exit 1; }
size=$(wc -c < "${ROOT}/apps/admin/dist/index.html")
[[ "${size}" -gt 100 ]] || { echo "index.html too small (${size}B)" >&2; exit 1; }
echo "  ✓ apps/admin/dist 已生成（index.html ${size}B）"

echo
echo "✅ M9 验收冒烟全部通过"
