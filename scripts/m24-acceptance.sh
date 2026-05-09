#!/usr/bin/env bash
# M24 验收冒烟：W3C Trace Context 后端贯穿
# - 不传 traceparent：响应有合法 traceresponse + log line 含 traceId
# - 传 traceparent：traceresponse 复用 traceId，spanId 是新的（fresh per request）
# - 传非法 traceparent：不报 4xx，traceresponse 是新生成的 traceId
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m24-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m24-smoke"
HOST_PORT="${HOST_PORT:-3024}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

PSQL_CMD="${PSQL_CMD:-docker exec -i mall-postgres psql -U mall -d mall}"
SKIP_PIPELINE="${SKIP_PIPELINE:-}"

TRACE_RE='^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（含 trace-context e2e）"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 2/4 "构建镜像 + 启容器"
docker build -f "${ROOT}/apps/api/Dockerfile" -t "${IMAGE_TAG}" "${ROOT}"
${PSQL_CMD} <<SQL >/dev/null
SELECT 1;
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
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && break
  sleep 1
  [[ "${i}" == "40" ]] && { echo "timeout"; docker logs "${CONTAINER}"; exit 1; }
done

step 3/4 "无 traceparent：traceresponse 自生成 + 合法格式"
tr1=$(curl -si "http://127.0.0.1:${HOST_PORT}/healthz" \
  | awk -F': ' 'tolower($1)=="traceresponse"{sub(/\r$/,"",$2); print $2}')
[[ "${tr1}" =~ ${TRACE_RE} ]] || { echo "invalid traceresponse: ${tr1}" >&2; exit 1; }
echo "  ✓ traceresponse=${tr1}"

step 4/4 "传入 traceparent：traceresponse 复用 traceId / 新 spanId / 非法格式不 4xx"
inbound_trace="4bf92f3577b34da6a3ce929d0e0e4736"
inbound_span="00f067aa0ba902b7"
inbound_tp="00-${inbound_trace}-${inbound_span}-01"
tr2=$(curl -si -H "traceparent: ${inbound_tp}" "http://127.0.0.1:${HOST_PORT}/healthz" \
  | awk -F': ' 'tolower($1)=="traceresponse"{sub(/\r$/,"",$2); print $2}')
[[ "${tr2}" =~ ${TRACE_RE} ]] || { echo "invalid: ${tr2}" >&2; exit 1; }
trace2=$(echo "${tr2}" | awk -F- '{print $2}')
span2=$(echo "${tr2}" | awk -F- '{print $3}')
[[ "${trace2}" == "${inbound_trace}" ]] || { echo "expected reused traceId got ${trace2}" >&2; exit 1; }
[[ "${span2}" != "${inbound_span}" ]] || { echo "spanId should be fresh, got ${span2}" >&2; exit 1; }
echo "  ✓ 复用上游 traceId=${trace2}，spanId=${span2}（≠上游）"

# 非法 traceparent：不 4xx，trace 重新生成
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'traceparent: definitely-not-w3c' \
  "http://127.0.0.1:${HOST_PORT}/healthz")
[[ "${code}" == "200" ]] || { echo "expected 200 on bad traceparent got ${code}" >&2; exit 1; }
echo "  ✓ 非法 traceparent 不报 4xx"

# 容器日志：抓任一请求，含 traceId 字段（pino customProps）
log_traces=$(docker logs "${CONTAINER}" 2>&1 | grep -o '"traceId":"[^"]*"' | head -3)
[[ -n "${log_traces}" ]] || { echo "no traceId in container logs" >&2; exit 1; }
echo "  ✓ 容器日志包含 traceId 字段："
# shellcheck disable=SC2001  # multi-line indent via sed is clearer than parameter expansion
echo "${log_traces}" | sed 's/^/      /'

echo
echo "✅ M24 验收冒烟全部通过"
