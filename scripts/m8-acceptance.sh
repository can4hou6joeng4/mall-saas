#!/usr/bin/env bash
# M8 验收冒烟：openapi:gen 输出 + 容器内 /docs-json 与 /docs 可访问
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m8-mock-secret-16-chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m8-smoke"
HOST_PORT="${HOST_PORT:-3008}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/6 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/6 "应用 Prisma 迁移 + 类型检查 / Lint / 测试 / 构建"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm typecheck
pnpm lint
pnpm test
pnpm build

step 3/6 "openapi:gen 离线生成 openapi.json"
pnpm --filter @mall/api openapi:gen
[[ -s "${ROOT}/apps/api/openapi.json" ]] || { echo "openapi.json missing" >&2; exit 1; }
path_count=$(python3 -c "import json,sys; d=json.load(open('${ROOT}/apps/api/openapi.json')); print(len(d['paths']))")
[[ "${path_count}" -ge 17 ]] || { echo "expected >=17 paths, got ${path_count}" >&2; exit 1; }
echo "  ✓ openapi.json 含 ${path_count} 个 paths"

step 4/6 "构建镜像并启动容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
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

step 5/6 "/docs-json 路径与 schemas 完备"
docs_json=$(curl -sf "http://127.0.0.1:${HOST_PORT}/docs-json")
remote_path_count=$(echo "${docs_json}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['paths']))")
[[ "${remote_path_count}" == "${path_count}" ]] || {
  echo "remote path count ${remote_path_count} != offline ${path_count}" >&2
  exit 1
}
echo "${docs_json}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert 'bearerAuth' in d['components']['securitySchemes'], 'missing bearerAuth'
print('  ✓ securitySchemes ok')
"

step 6/6 "/docs UI 加载（HTML 含 swagger-ui）"
docs_html=$(curl -sf "http://127.0.0.1:${HOST_PORT}/docs")
echo "${docs_html}" | grep -qi 'swagger' || { echo "/docs UI 未渲染 swagger" >&2; exit 1; }
echo "  ✓ /docs UI 可加载"

echo
echo "✅ M8 验收冒烟全部通过"
