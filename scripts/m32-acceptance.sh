#!/usr/bin/env bash
# M32 验收冒烟：三前端浏览器级 e2e 全跑通
# - admin / storefront / store 各跑 playwright（preview server + route mock，不依赖真后端）
# - 跑全工作区 typecheck/lint/test/build 保底
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

step() { echo; echo "=== [$1] $2 ==="; }

step 1/3 "类型检查 / Lint / vitest 单测 / 构建"
pnpm typecheck && pnpm lint && pnpm test && pnpm build

step 2/3 "确认 chromium 已安装"
chromiums=("${HOME}/Library/Caches/ms-playwright/"chromium-*)
[[ -e "${chromiums[0]}" ]] || {
  echo "chromium 未安装，请先在任一 e2e 工作区执行 pnpm exec playwright install chromium" >&2
  exit 1
}

step 3/3 "三前端 playwright e2e（admin / storefront / store）"
for app in admin storefront store; do
  echo
  echo "  ─── @mall/${app} ─────────────────────────────"
  pnpm --filter "@mall/${app}" exec playwright test 2>&1 | tail -10
done

echo
echo "✅ M32 验收冒烟全部通过"
