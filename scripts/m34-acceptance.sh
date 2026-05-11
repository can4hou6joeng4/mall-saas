#!/usr/bin/env bash
# M34 验收冒烟：OpenTelemetry SDK 启用后 span 数据导出
# - OTEL_ENABLED=true + OTEL_EXPORTER=console：容器 stdout 必含 span 数据
# - W3C traceparent 在 OTel 启用后仍正确解析（M24 契约不破）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m34-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m34-smoke"
HOST_PORT="${HOST_PORT:-3034}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（OTel 关闭时无回归）"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 2/4 "构建镜像 + 启容器（OTEL_ENABLED=true + OTEL_EXPORTER=console）"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"

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
  -e OTEL_ENABLED=true \
  -e OTEL_EXPORTER=console \
  -e OTEL_SERVICE_NAME=mall-api-m34 \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  sleep 1
  [[ "${i}" == "60" ]] && { echo "timeout"; docker logs "${CONTAINER}"; exit 1; }
done

step 3/4 "发请求触发 span：自定义 traceparent + 普通请求"
INBOUND_TRACE="4bf92f3577b34da6a3ce929d0e0e4736"
INBOUND_SPAN="00f067aa0ba902b7"
INBOUND_TP="00-${INBOUND_TRACE}-${INBOUND_SPAN}-01"

# 1) 带 traceparent 的请求（应在 span 数据里体现 traceId=${INBOUND_TRACE}）
trh=$(curl -s -D - -o /dev/null "http://127.0.0.1:${HOST_PORT}/healthz" \
  -H "traceparent: ${INBOUND_TP}" | grep -i '^traceresponse:' | tr -d '\r' | head -1)
echo "${trh}" | grep -q "${INBOUND_TRACE}" || {
  echo "expected traceresponse to reuse inbound traceId, got: ${trh}" >&2; exit 1;
}
echo "  ✓ M24 traceparent 在 OTel 启用后仍正确：${trh}"

# 2) 几个普通请求触发 fastify auto-instrumentation 出 span
for _ in 1 2 3; do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null
done

# OTel SDK 默认 batch 5s flush；等 7s 让 console exporter 落到 stdout
sleep 7

step 4/4 "容器 stdout 含 OTel span（traceId / parentSpanId 字段）"
logs=$(docker logs "${CONTAINER}" 2>&1)
# ConsoleSpanExporter 输出 JS 对象字面量风格：`traceId: 'xxx',`
echo "${logs}" | grep -Eq "traceId: '[0-9a-f]+'" || {
  echo "no OTel span in stdout（is OTEL_ENABLED 没生效？）" >&2
  docker logs "${CONTAINER}" 2>&1 | tail -30
  exit 1
}
span_count=$(echo "${logs}" | grep -Ec "traceId: '[0-9a-f]+'" || true)
echo "  ✓ stdout 共出现 ${span_count} 行 OTel span（含 traceId 字段）"

# 关键资源属性也校验：service.name 应是 OTEL_SERVICE_NAME
echo "${logs}" | grep -q "mall-api-m34" || {
  echo "service.name 没设到 OTEL_SERVICE_NAME"; exit 1
}
echo "  ✓ resource.service.name=mall-api-m34 已传入"

echo
echo "✅ M34 验收冒烟全部通过"
