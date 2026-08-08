# Security Policy

## Reporting a vulnerability

请不要在公开 Issue 中提交可被利用的漏洞、Token、备份文件或隐私 vault。请通过 GitHub 仓库的 **Security → Report a vulnerability** 私下报告，并包含受影响版本、复现步骤和影响范围；维护者确认后再协调公开披露。

## Security model

- GitHub Personal Access Token 仅保存在当前浏览会话的 `sessionStorage`，不会写入持久化 `localStorage`。
- 隐私桌面使用 AES-256-GCM；新 vault 的 6 位 PIN 经 PBKDF2-SHA-256 600,000 次迭代派生密钥。6 位 PIN 仍属于低熵凭据，不能抵抗拥有 vault 副本的长期离线穷举。
- Web 版不加载第三方 JSONP/远程脚本作为搜索建议。外部导航只接受 `http:`/`https:`。
- 云同步使用远端 HEAD 乐观并发检查，检测到多设备更新时停止覆盖。

建议保持同步仓库为私有、为同步 Token 使用最小权限，并启用 GitHub 账号 MFA。
