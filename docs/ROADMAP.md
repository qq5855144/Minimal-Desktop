# Minimal Desktop Roadmap

当前阶段先把数据完整性、安全与发布质量作为稳定基线。后续功能按以下顺序推进，避免再次把业务规则散落到 UI 事件中。

## P1 — 可恢复的桌面编辑

- Undo / Redo：基于纯 `DesktopData` mutation 记录有限历史。
- 布局快照：支持命名保存、预览和恢复不同桌面布局。
- 导入预览：云端下载先展示差异摘要，再由用户确认覆盖/合并。

## P2 — 离线与快速访问

- PWA / Service Worker：缓存静态资源与远程图标的安全降级资源。
- 全局命令搜索：统一搜索应用、文件夹、系统操作与搜索引擎。
- 同步状态中心：展示本地/远端 HEAD、最后同步时间和冲突恢复入口。

## P3 — 可扩展组件体系

- Widget SDK：以 `widgetType → config + renderer` 为唯一注册入口，并声明 `rowSpan`、权限和持久化 schema。
- Widget 错误边界与版本迁移，避免单个组件破坏整个桌面。
- 在布局引擎测试中加入每种 widget 的 placement property tests。

## P4 — 扩展发布自动化

- 在 tag/release 上构建并打包 `dist-ext`。
- 自动校验 manifest 版本与 `package.json` 版本一致。
- 生成带校验和的 Chrome/Firefox 发布包，并保留可复现构建日志。
