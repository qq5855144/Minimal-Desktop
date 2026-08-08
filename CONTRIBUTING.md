# Contributing

感谢参与 Minimal Desktop。

1. 从最新 `main` 创建短生命周期分支。
2. 使用 `pnpm install --frozen-lockfile` 安装依赖。
3. 变更布局、同步、导入或加密逻辑时补充对应 Vitest 回归测试。
4. 提交前运行 `pnpm check`，确保类型检查、lint、测试、Web 与扩展构建全部通过。
5. PR 请说明用户可见变化、兼容性/迁移影响和验证方式；安全问题请遵循 `SECURITY.md` 私下报告。

布局写入规则集中在 `src/lib/layoutEngine.ts`。新增拖拽或组件能力应复用该模块，避免在 UI 中复制网格约束。
