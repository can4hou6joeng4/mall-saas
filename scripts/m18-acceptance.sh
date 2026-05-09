#!/usr/bin/env bash
# M18 验收冒烟：admin Playwright E2E（无后端依赖，路由 mock）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

step() { echo; echo "=== [$1] $2 ==="; }

step 1/3 "类型检查 / Lint / vitest 单测 / 构建（含 admin 工作区）"
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/3 "确认 chromium 已安装"
chromiums=("${HOME}/Library/Caches/ms-playwright/"chromium-*)
[[ -e "${chromiums[0]}" ]] || {
  echo "chromium 未安装，请先在 apps/admin 执行 pnpm exec playwright install chromium" >&2
  exit 1
}

step 3/3 "运行 admin Playwright E2E（preview server + 路由 mock）"
pnpm --filter @mall/admin exec playwright test 2>&1 | tail -30

echo
echo "✅ M18 验收冒烟全部通过"
