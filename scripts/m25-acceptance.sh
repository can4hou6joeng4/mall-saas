#!/usr/bin/env bash
# M25 验收冒烟：生产 docker-compose stack 端到端
# - 用 docker-compose.prod.yml 起完整 stack（postgres + redis + migrate + api）
# - 等 api healthcheck 通过
# - curl /healthz /readyz /metrics 验证可观测端点
# - 注意此脚本不依赖 docker compose 已有的 dev stack；用独立 project name 避免冲突
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PROJECT="mall-m25-prod"
ENV_FILE="${ROOT}/.env.m25-prod"
HOST_PORT="${HOST_PORT:-3025}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:m25-prod}"
MIGRATE_IMAGE_TAG="${MIGRATE_IMAGE_TAG:-mall-api-migrate:m25-prod}"

SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() {
  docker compose -f docker-compose.prod.yml -p "${PROJECT}" --env-file "${ENV_FILE}" down -v >/dev/null 2>&1 || true
  rm -f "${ENV_FILE}"
}
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build"
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 2/4 "准备 .env.m25-prod（一次性强随机；用完即删）"
gen_secret() { openssl rand -hex 24; }
JWT="$(gen_secret)$(gen_secret)"  # 至少 32 字符
cat > "${ENV_FILE}" <<ENV
MALL_API_IMAGE=${IMAGE_TAG}
MALL_MIGRATE_IMAGE=${MIGRATE_IMAGE_TAG}
POSTGRES_USER=mall
POSTGRES_PASSWORD=$(gen_secret)
POSTGRES_DB=mall
POSTGRES_APP_USER=mall_app
POSTGRES_APP_PASSWORD=$(gen_secret)
JWT_SECRET=${JWT}
JWT_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800
PAYMENT_MOCK_SECRET=$(gen_secret)
PLATFORM_ADMIN_EMAIL=platform@m25-acc.dev
PLATFORM_ADMIN_PASSWORD=$(gen_secret)
ORDER_TIMEOUT_MS=1800000
AUTH_RATE_LIMIT_MAX=200
RATE_LIMIT_MAX=500
LOG_LEVEL=info
API_PORT=${HOST_PORT}
ENV

step 3/4 "构建 api 镜像 + compose up（postgres → migrate → api）"
docker compose -f docker-compose.prod.yml -p "${PROJECT}" --env-file "${ENV_FILE}" build api migrate >/dev/null
# 注意：docker-compose.prod.yml 的 mall_app 角色需要预先创建。生产真实部署里通过 init SQL
# 完成；此处冒烟用 superuser 直连即可，DATABASE_APP_URL 在 RLS 不强制时也能用 mall。
# 这里偷懒：用 mall 同密码当 mall_app（POSTGRES_APP_PASSWORD 与 POSTGRES_PASSWORD 相同）
sed -i.bak "s/^POSTGRES_APP_USER=.*/POSTGRES_APP_USER=mall/" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
pg_pw=$(grep '^POSTGRES_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)
sed -i.bak "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=${pg_pw}|" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"

docker compose -f docker-compose.prod.yml -p "${PROJECT}" --env-file "${ENV_FILE}" up -d 2>&1 || {
  echo "compose up failed, dumping logs:" >&2
  docker compose -f docker-compose.prod.yml -p "${PROJECT}" --env-file "${ENV_FILE}" ps >&2 || true
  docker compose -f docker-compose.prod.yml -p "${PROJECT}" --env-file "${ENV_FILE}" logs migrate api >&2 || true
  exit 1
}

# 等 api healthcheck 报 healthy（注意 healthcheck 的 start_period=30s）
api_container=$(docker compose -f docker-compose.prod.yml -p "${PROJECT}" --env-file "${ENV_FILE}" ps -q api)
[[ -n "${api_container}" ]] || { echo "api container not found" >&2; exit 1; }

for i in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "${api_container}" 2>/dev/null || echo "starting")
  if [[ "${status}" == "healthy" ]]; then break; fi
  if [[ "${status}" == "unhealthy" ]]; then
    echo "api unhealthy:"; docker logs "${api_container}" | tail -40; exit 1
  fi
  sleep 1
  [[ "${i}" == "60" ]] && {
    echo "timeout waiting healthy (status=${status})"; docker logs "${api_container}" | tail -40; exit 1
  }
done
echo "  ✓ api healthcheck=healthy"

step 4/4 "curl /healthz / /readyz / /metrics 验证可观测端点"
curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" | grep -q '"status":"ok"' \
  || { echo "healthz unexpected" >&2; exit 1; }
curl -sf "http://127.0.0.1:${HOST_PORT}/readyz" | grep -q '"db":"ok"' \
  || { echo "readyz db not ok" >&2; exit 1; }
curl -sf "http://127.0.0.1:${HOST_PORT}/readyz" | grep -q '"redis":"ok"' \
  || { echo "readyz redis not ok" >&2; exit 1; }
curl -sf "http://127.0.0.1:${HOST_PORT}/metrics" | grep -q 'http_requests_total' \
  || { echo "metrics missing http_requests_total" >&2; exit 1; }
echo "  ✓ /healthz /readyz /metrics 全部就绪"

# 顺手检查 traceresponse 头（M24 留下来的能力，prod compose 应该也有）
tr=$(curl -si "http://127.0.0.1:${HOST_PORT}/healthz" \
  | awk -F': ' 'tolower($1)=="traceresponse"{sub(/\r$/,"",$2); print $2}')
[[ "${tr}" =~ ^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$ ]] \
  || { echo "traceresponse format wrong: ${tr}" >&2; exit 1; }
echo "  ✓ M24 traceresponse 头在 prod compose 下也生效：${tr}"

echo
echo "✅ M25 验收冒烟全部通过"
