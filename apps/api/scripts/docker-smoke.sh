#!/usr/bin/env bash
# 镜像冒烟：构建 -> 启动容器 -> 命中 /healthz、/readyz -> 清理
# 依赖：本机已 docker compose up -d postgres redis（或同等环境）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-mall-api:smoke}"
CONTAINER="${CONTAINER:-mall-api-smoke}"
HOST_PORT="${HOST_PORT:-3001}"

cleanup() {
  if [[ -n "${KEEP_CONTAINER:-}" ]]; then
    return
  fi
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building image ${IMAGE_TAG}"
docker build \
  -f "${ROOT}/apps/api/Dockerfile" \
  -t "${IMAGE_TAG}" \
  "${ROOT}"

echo "==> Starting container ${CONTAINER} on host port ${HOST_PORT}"
docker run -d \
  --name "${CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://mall:mall@host.docker.internal:5432/mall?schema=public" \
  -e DATABASE_APP_URL="postgresql://mall_app:mall_app@host.docker.internal:5432/mall?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p "${HOST_PORT}:3000" \
  "${IMAGE_TAG}" >/dev/null

echo "==> Waiting for /healthz to come up"
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null; then
    break
  fi
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "Container exited early. Logs:" >&2
    docker logs "${CONTAINER}" >&2 || true
    exit 1
  fi
  sleep 1
  if [[ "${i}" == "40" ]]; then
    echo "Timed out waiting for /healthz" >&2
    docker logs "${CONTAINER}" >&2 || true
    exit 1
  fi
done

echo "==> GET /healthz"
HEALTHZ=$(curl -sf "http://127.0.0.1:${HOST_PORT}/healthz")
echo "${HEALTHZ}"
[[ "${HEALTHZ}" == '{"status":"ok"}' ]] || { echo "healthz body mismatch" >&2; exit 1; }

echo "==> GET /readyz"
READYZ=$(curl -sf "http://127.0.0.1:${HOST_PORT}/readyz")
echo "${READYZ}"
echo "${READYZ}" | grep -q '"status":"ok"' || { echo "readyz not ok" >&2; exit 1; }
echo "${READYZ}" | grep -q '"db":"ok"' || { echo "db check not ok" >&2; exit 1; }

echo "==> Smoke OK"
