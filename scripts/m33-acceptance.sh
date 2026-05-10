#!/usr/bin/env bash
# M33 验收冒烟：storefront i18n 拉通
# - 全工作区 typecheck/lint/test/build（含 i18n.spec jsdom + playwright）
# - 后端 BusinessException 在 Accept-Language=en 下返回英文消息（M17 能力对账）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export DATABASE_URL="${DATABASE_URL:-postgresql://mall:mall@localhost:5432/mall?schema=public}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgresql://mall_app:mall_app@localhost:5432/mall?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-must-be-at-least-thirty-two-chars}"
export PAYMENT_MOCK_SECRET="${PAYMENT_MOCK_SECRET:-m33-mock-secret-16chars}"
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-platform@example.com}"
export PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-platform-pw-1234}"

CONTAINER="mall-api-m33-smoke"
HOST_PORT="${HOST_PORT:-3033}"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"

PSQL_CMD="${PSQL_CMD:-docker exec -i mall-postgres psql -U mall -d mall}"
SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step 1/4 "全工作区 typecheck / lint / test / build（含 storefront i18n jsdom）"
pnpm --filter @mall/api exec prisma migrate deploy
pnpm --filter @mall/api exec prisma generate
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 2/4 "storefront playwright（含 locale switcher EN/中文 切换）"
pnpm --filter @mall/storefront exec playwright test 2>&1 | tail -10

step 3/4 "构建镜像 + 启容器（验后端 Accept-Language 拉通）"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t "${IMAGE_TAG}" "${ROOT}"
${PSQL_CMD} <<SQL >/dev/null
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

step 4/4 "后端 Accept-Language 切换：错误消息跟随 locale（M17 → M33 闭环）"
${PSQL_CMD} <<SQL >/dev/null
INSERT INTO "Tenant" (id, name) VALUES (9933, 'm33-acc')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
DELETE FROM "User" WHERE "tenantId" = 9933;
SQL
reg=$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/auth/register" \
  -H 'content-type: application/json' \
  -d '{"tenantId":9933,"email":"m33-i18n@example.com","password":"m33-pw-1234"}')
utok=$(echo "${reg}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

# GET /products/9999999 → BusinessException product.notFound 走 i18n 字典
zh_msg=$(curl -s "http://127.0.0.1:${HOST_PORT}/products/9999999" \
  -H "authorization: Bearer ${utok}" -H 'accept-language: zh-CN' \
  | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
en_msg=$(curl -s "http://127.0.0.1:${HOST_PORT}/products/9999999" \
  -H "authorization: Bearer ${utok}" -H 'accept-language: en' \
  | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
echo "  zh-CN: ${zh_msg}"
echo "  en:    ${en_msg}"
[[ "${zh_msg}" == *"不存在"* ]] || { echo "expected 中文 message, got: ${zh_msg}" >&2; exit 1; }
[[ "${en_msg}" == *"not found"* ]] || { echo "expected English message, got: ${en_msg}" >&2; exit 1; }
echo "  ✓ Accept-Language 正确切换 BusinessException 消息（M17 字典 → storefront 拉通）"

echo
echo "✅ M33 验收冒烟全部通过"
