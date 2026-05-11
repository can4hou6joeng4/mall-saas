## 摘要

<!-- 1-2 句说明这个 PR 在解决什么问题或引入什么能力 -->

## 类型

<!-- 勾选所有适用项 -->

- [ ] feat — 新增功能
- [ ] fix — 修复 bug
- [ ] docs — 仅文档
- [ ] refactor — 不改变行为的重构
- [ ] perf — 性能改进
- [ ] test — 补充测试
- [ ] ci — CI / 构建脚本
- [ ] chore — 杂项

## 涉及层

- [ ] 后端 `apps/api`
- [ ] 前端 `apps/admin`
- [ ] 前端 `apps/store`
- [ ] 前端 `apps/storefront`
- [ ] 共享 `packages/shared`
- [ ] CI / scripts
- [ ] 文档

## 影响 & 风险

<!-- 如果改了数据库 schema / 公开 API / RLS 策略 / 鉴权流程，写明影响。其他情况可写 N/A -->

- 数据库迁移：N/A
- 公开 API 变更：N/A
- RLS / 鉴权变更：N/A
- Breaking change：否

## 验证

<!-- 勾选已通过的验证；至少需要 typecheck + lint + test -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] 相关 `scripts/m{N}-acceptance.sh` 跑通
- [ ] 三前端 Playwright（若涉及 UI）

## 关联

<!-- 关联的 issue 或里程碑，例如 closes #12；新里程碑可写 milestone vX.Y.0-m{N} -->
