# Changelog
## Unreleased
### Added
- 云同步新增「保持登录」开关：默认 Token 仅会话级存储（`sessionStorage`），勾选后持久化到 `localStorage`，关闭浏览器后仍保持连接。
- 同步连接、上传与下载增加 Token 失效（401/403）前置检查与统一的面向用户错误提示。
### Removed
- 移除仓库内 AI 开发工具链残留：`.skills/`、`.rules/`、`sgconfig.yml`、`historical_context.txt`、`tasks/` 截图与 `.env`。
- 移除未使用的页面（`src/pages/`）与约 66 个未引用的 shadcn UI 组件，仅保留 button / input / sonner / tooltip。
- 移除未使用的依赖（axios、ky、streamdown、recharts、motion、cmdk、vaul、video-react、@sentry/react、miaoda 等 50 个）。
- 默认壁纸由外部 CDN 改为本地 SVG 资源。
### Changed
- 示例备份数据移入 `docs/examples-desktop-backup.json`。
- `pnpm-workspace.yaml` 移除无关 workspace/catalog 配置。
- 类型检查覆盖全部 `src`（含保留的 UI 组件）。
## 1.2.0
### Added
- 普通桌面支持最多 50 步 Undo / Redo，并提供 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z` 快捷键。
- 云端恢复增加差异预览与二次确认，覆盖前展示页面、项目及新增/删除/移动/修改数量，并明确隐私 vault 状态。

### Changed

- 精简设置面板，移除布局快照及撤销/重做按钮，桌面操作历史改为仅通过快捷键使用。
- 统一桌面布局规则并保护隐私桌面跨边界拖拽，避免覆盖目标项目与 widget 越界。
- 云同步统一包含加密隐私 vault，并增加远端 HEAD 冲突保护。
- GitHub Token 改为会话级存储；移除 Web JSONP、硬编码 Pixabay Key 与第三方 CORS 代理。
- 本地壁纸改用 IndexedDB；本地图标在持久化前缩放压缩。
- 隐私 vault 新写入使用 PBKDF2 600,000 次迭代，同时保持旧 vault 兼容。
- 云端/本地导入增加 Zod 结构校验与布局重排。
- 恢复标准开发/构建/测试脚本，CI 增加 typecheck、lint、Vitest、Web 和扩展构建门禁。
- 对设置、同步、文件夹、隐私等低频界面启用懒加载，降低首屏 JavaScript 体积。
