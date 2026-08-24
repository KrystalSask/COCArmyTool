# COCArmyTool Windows 开发测试入口

本入口用于项目开发阶段：双击后直接打开 Tauri 桌面界面，不需要每次手工打开终端或输入命令，同时保留 Vite 热更新能力。它不是安装包，也不会修改 Windows 的程序安装列表。

## 使用方式

在项目根目录双击以下任一入口：

- `COCArmyTool 开发测试.lnk`：当前电脑上的推荐快捷方式，显示项目图标。
- `COCArmyTool-开发测试.vbs`：仓库内的可移动入口；重新克隆或更换目录后仍可使用。

启动时会短暂显示“正在启动”提示，随后出现 COCArmyTool 桌面窗口。底层开发命令窗口保持隐藏。

## 启动器会做什么

1. 自动定位项目根目录。
2. 检查 Node.js、npm、Rust 和 Cargo。
3. 如果缺少 `node_modules`，自动运行 `npm install`。
4. 在隐藏窗口中运行 `npm run desktop:dev`。
5. 启动 Vite 开发服务和 Tauri 桌面窗口。
6. 将标准输出和错误日志保存到 `artifacts/`。

关闭桌面窗口后，Tauri 开发命令会正常退出。若应用已经运行，再次双击只会提示已有实例，不会重复占用开发端口。

## 热更新

- 修改 React、TypeScript 或 CSS 后，桌面窗口会自动刷新。
- 修改 Rust/Tauri 代码后，Tauri 会重新编译并重启桌面进程。
- 不需要重新制作 EXE 或安装包。

## 首次环境要求

- Windows 10/11。
- Node.js 22 或更高版本和 npm。
- Rust stable 与 Cargo。
- Microsoft Edge WebView2 Runtime。

当前开发电脑已经具备这些环境。其他电脑首次使用时需要先安装 Node.js 和 Rust；依赖包由入口自动安装。

## 日志和故障排查

```text
artifacts/desktop-dev.stdout.log
artifacts/desktop-dev.stderr.log
```

如果双击后没有出现窗口：

1. 等待首次 Rust 编译完成。
2. 查看上述错误日志。
3. 确认没有另一个 COCArmyTool 实例占用端口。
4. 运行 `npm run check` 检查开发环境。
5. 必要时在终端运行 `npm run desktop:dev` 查看实时错误。

`COCArmyTool 开发测试.lnk` 包含当前电脑的绝对路径，因此不提交 Git；`COCArmyTool-开发测试.vbs` 和 `scripts/dev-launcher.ps1` 会提交并可在其他工作区重新生成快捷方式。
