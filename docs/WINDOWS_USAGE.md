# COCArmyTool Windows 开发启动

本文面向开发者，说明在 Windows 上如何启动桌面开发版、热更新和排障。最终用户请使用便携版发布包（见 [便携版发布](PORTABLE_RELEASE.md)），不需要本页的任何工具。

## 开发版启动方式

开发版需要 Node.js 22+、npm 和 Rust stable。初始化并检查环境：

```powershell
npm install
npm run check
```

启动 Tauri 桌面开发版（带 Vite 热更新）：

```powershell
npm run desktop:dev
```

或使用统一入口：

```powershell
.\start.ps1 desktop
.\start.ps1   # 打开任务菜单
```

也可以直接双击项目根目录的 `启动开发测试版.cmd`。它等价于
`.\start.ps1 desktop`，会启动当前工作区的桌面开发版并加载最新源码与模型；
启动窗口会保留终端日志，便于验收时查看错误。

`start.ps1` 只负责定位项目根目录并调用 `scripts/start.mjs`；实际任务始终来自 `package.json`。

## 热更新

- 修改 React、TypeScript 或 CSS 后，桌面窗口会自动刷新。
- 修改 Rust/Tauri 代码后，Tauri 会重新编译并重启桌面进程。
- 不需要重新打包 EXE 或 ZIP。

## 首次环境要求

- Windows 10/11。
- Node.js 22 或更高版本和 npm。
- Rust stable 与 Cargo。
- Microsoft Edge WebView2 Runtime（仅最终用户的便携版强制要求）。

## 日志和故障排查

开发版在前台运行，错误直接显示在终端。常见问题：

1. 等待首次 Rust 编译完成（首次可能需要几分钟）。
2. 确认没有另一个开发实例占用端口 1420。
3. 运行 `npm run check` 检查开发环境。
4. 查看 [常见故障](MAINTENANCE.md#10-常见故障) 一节。

说明：`启动开发测试版.cmd` 仅用于开发和验收，最终用户仍应使用便携版发布包。
