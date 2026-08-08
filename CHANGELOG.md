# Changelog

## Unreleased

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
