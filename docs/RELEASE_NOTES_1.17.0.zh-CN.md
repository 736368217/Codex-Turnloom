# Codex-Turnloom 1.17.0 发布说明

- 发布日期：2026-10-23
- 版本：`1.17.0`（Android `versionCode` 21）
- 桌面安装包：`Codex-Turnloom-Console-1.17.0-x64.exe`
- 校验值：SHA-512 见 `dist-desktop/latest.yml`；SHA-256 `97458B051CCC4395B4BDBDE9DA8C7D2C025E6AF89295AB25E5376F014C67A823`

## 重点更新

- **短时会话登录**：`/login?token=...` 将访问码换取 8 小时 HttpOnly `turnloom_session` cookie，302 到不带 token 的地址；`/api/auth/logout` 立即吊销；Web 客户端也可用 `/api/auth/session` 主动交换。
- **单端口多 Codex home**：`--profiles` 现在支持多个 Codex home 和多个 HTTP 后端，请求级隔离缓存，跨 profile thread id 返回 404。
- **HTTP 后端能力补全**：pin、goal、compact、branch、approval、queue cancel/steer、changes 全部透传；account/plugins/skills 返回安全空值，不读取本地 Codex 数据。
- **桌面安装向导**：按 `realpath` 去重 junction 目录，`C:\Users\<user>\.codex` 与 `D:\codex\.codex` 只显示一个选项；补充目录选择与 PI-Desktop 导入边界说明。
- **保留 1.16.0 的移动端 V2、托盘控制台、P0/P2 可靠性改进**。

## 升级说明

- 已有 `%LOCALAPPDATA%\CodexPocket\config.json` 会复用，无需重新配对。
- 首次使用托盘控制台会打开三步向导：检测 Codex 数据目录 → 设置端口/访问码 → 启动并显示配对二维码。
- 安装包未做代码签名，首次运行可能出现 SmartScreen 提示。
- HTTP 后端扩展能力取决于适配器实现；未实现的操作会返回对应后端错误，不影响基础浏览/发送/中断。

## 验证

- `npm run check` 通过。
- `npm test`：92 项全部通过。
- `npm run desktop:check` 通过。
- Electron 开发模式与打包后的 `win-unpacked` 通过 `--smoke-test`（`state: running`）。
- 双 Codex home profile：两个 token 分别看到不同 thread 列表，双向跨 profile 均返回 404。
- 短会话：`/login?token=...` 后 cookie 请求成功，logout 后返回 401。
- NSIS 安装包将输出到 `dist-desktop/Codex-Turnloom-Console-1.17.0-x64.exe`。
