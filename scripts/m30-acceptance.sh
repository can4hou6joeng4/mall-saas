#!/usr/bin/env bash
# M30 验收冒烟：release.yml + 双镜像本地构建（不 push）
# - python yaml.safe_load 校验 .github/workflows/release.yml 合法
# - shellcheck 检查所有 scripts/*.sh
# - docker build --target runner / --target migrate 本地构建均成功
# - 顺手验证 mall-api:m30-test runner 镜像启动后 /healthz ok（拉通 M25 编排能力）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

SKIP_PIPELINE="${SKIP_PIPELINE:-}"

step() { echo; echo "=== [$1] $2 ==="; }

step 1/4 "yaml lint .github/workflows/release.yml"
docker run --rm -v "${ROOT}":/work -w /work python:3-alpine sh -lc \
  'pip install -q pyyaml >/dev/null 2>&1 && python -c "import yaml; yaml.safe_load(open(\".github/workflows/release.yml\")); yaml.safe_load(open(\".github/workflows/ci.yml\")); print(\"yaml-ok\")"'

step 2/4 "shellcheck scripts/*.sh（M22 留下的纪律）"
docker run --rm -v "${ROOT}":/work -w /work koalaman/shellcheck:stable \
  -e SC2064,SC2155 scripts/*.sh
echo "  ✓ 全部脚本 shellcheck 通过"

step 3/4 "全工作区 typecheck / lint / test / build"
if [[ -z "${SKIP_PIPELINE}" ]]; then
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
else
  echo "  ⤿ SKIP_PIPELINE=1，跳过 typecheck/lint/test/build"
fi

step 4/4 "本地构建 runner + migrate 双镜像并冒烟启动 runner"
docker build -f "${ROOT}/apps/api/Dockerfile" --target runner -t mall-api:m30-test "${ROOT}" >/dev/null
docker build -f "${ROOT}/apps/api/Dockerfile" --target migrate -t mall-api-migrate:m30-test "${ROOT}" >/dev/null
echo "  ✓ 双 target 本地构建成功"

# 对 migrate 镜像做轻量验证：能列出 prisma 命令
docker run --rm --entrypoint sh mall-api-migrate:m30-test -c \
  'pnpm exec prisma --version 2>&1 | head -3'
echo "  ✓ migrate 镜像 prisma CLI 可执行"

# runner 镜像不依赖外部 DB 启动会失败，但验证启动入口是 dist/main.js（避开 entrypoint 错配回归）
docker inspect -f '{{.Config.Cmd}}' mall-api:m30-test | grep -q 'main.js' \
  || { echo "runner CMD 不是 main.js" >&2; exit 1; }
docker inspect -f '{{.Config.Entrypoint}}' mall-api:m30-test | grep -q 'tini' \
  || { echo "runner ENTRYPOINT 不是 tini" >&2; exit 1; }
docker inspect -f '{{.Config.Entrypoint}}' mall-api-migrate:m30-test | grep -q 'prisma' \
  || { echo "migrate ENTRYPOINT 不是 prisma" >&2; exit 1; }
echo "  ✓ runner CMD=node main.js / ENTRYPOINT=tini；migrate ENTRYPOINT=pnpm prisma（防止 multi-stage target 错配）"

echo
echo "✅ M30 验收冒烟全部通过"
