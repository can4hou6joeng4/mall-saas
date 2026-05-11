#!/usr/bin/env bash
# M7 验收冒烟：在 M6 基础上叠加 helmet 头 + rate-limit + /metrics 现网验证
# 前置：docker compose up -d postgres redis
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m7-acceptance-mock-secret}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"
export NODE_ENV="${NODE_ENV:-test}"
export LOG_LEVEL="${LOG_LEVEL:-error}"

CONTAINER="mall-api-m7-smoke"
HOST_PORT="${HOST_PORT:-3007}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/7 "确认本地依赖容器存活"
docker compose ps postgres redis | grep -E "running|healthy" >/dev/null

step 2/7 "应用 Prisma 迁移"
pnpm --filter @mall/api exec prisma migrate deploy

step 3/7 "类型检查 / Lint / 测试 / 构建"
pnpm typecheck
pnpm lint
pnpm test
pnpm build

step 4/7 "构建镜像并启动容器（RATE_LIMIT_MAX=10 便于触发 429）"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
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
  -e RATE_LIMIT_MAX=10 \
  -e RATE_LIMIT_WINDOW="10 seconds" \
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

step 5/7 "helmet 安全头校验"
headers=$(curl -sI "http://127.0.0.1:${HOST_PORT}/healthz")
echo "${headers}" | grep -qi 'x-content-type-options: nosniff' || {
  echo "missing x-content-type-options" >&2; exit 1
}
echo "${headers}" | grep -qi 'x-frame-options' || {
  echo "missing x-frame-options" >&2; exit 1
}
echo "${headers}" | grep -qi 'strict-transport-security' || {
  echo "missing strict-transport-security" >&2; exit 1
}
echo "  ✓ helmet 头齐全"

step 6/7 "/metrics 端点暴露 prometheus 文本"
metrics=$(curl -sf "http://127.0.0.1:${HOST_PORT}/metrics")
echo "${metrics}" | grep -q 'http_requests_total' || {
  echo "metrics body missing http_requests_total" >&2; exit 1
}
echo "${metrics}" | grep -q 'http_request_duration_seconds' || {
  echo "metrics body missing http_request_duration_seconds" >&2; exit 1
}
echo "  ✓ /metrics 含核心指标"

step 7/7 "rate-limit 触发 429"
hit_429=0
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/healthz")
  if [[ "${code}" == "429" ]]; then
    hit_429=1
    break
  fi
done
[[ "${hit_429}" == "1" ]] || { echo "did not hit 429 within 30 requests" >&2; exit 1; }
echo "  ✓ 第 ${i} 次请求触发 429"

echo
echo "✅ M7 验收冒烟全部通过"
