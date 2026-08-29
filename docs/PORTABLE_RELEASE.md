# COCArmyTool 便携版发布

本文说明如何从源码构建对外分发的 Windows x64 便携版（免安装 ZIP），以及产物的边界与验证要求。

## 构建命令

```powershell
npm run release:portable
```

等价于直接运行打包脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1
```

脚本为 Windows-only，按顺序执行并任一步失败即中止（fail-fast）：

1. 生产前端构建：`npm run build`（tsc + vite，产物 `dist/`）。
2. Tauri release 构建：`npm run desktop:release`，即 `tauri build --no-bundle`——只产出 release EXE，不生成 NSIS/MSI 安装包，也不需要 NSIS 工具链。构建前会删除旧 EXE，确保不会打包过期二进制。
3. 暂存运行时交付物：`src-tauri/target/release/coc-army-tool.exe` 改名为 `COCArmyTool.exe`，连同 `使用说明.txt`（模板 `scripts/portable-readme-zh.txt`，自动填入版本号与日期）一起放入暂存目录。
4. 压缩为 `release/COCArmyTool-v<版本>-windows-x64-portable.zip`，并校验 ZIP 只含上述两个条目。

版本号只从 `src-tauri/tauri.conf.json` 的 `version` 读取（当前 `0.3.0`），不支持命令行覆盖，确保 ZIP 文件名、EXE 产品版本与项目元数据一致；打包前还会校验 EXE 的 PE 架构为 x64，任何不一致都直接失败。产物路径固定为：

```text
release/COCArmyTool-v0.3.0-windows-x64-portable.zip
```

## 产物结构

```text
COCArmyTool-v0.3.0-windows-x64-portable.zip
├── COCArmyTool.exe   用户启动入口（x64 release 二进制）
└── 使用说明.txt       简体中文使用说明
```

ZIP 不包含源码、node_modules、测试、识别样本、训练脚本、日志或构建树；运行时模型（ONNX 分类器、OCR 等）已随前端资源嵌入 EXE 内部，无需外置文件。

## 运行环境

- 目标平台：Windows 10/11 64 位（x64）。
- 依赖：Microsoft Edge WebView2 运行时（Windows 11 通常自带；Windows 10 需单独安装）。应用不要求 Node.js、Rust、Vite 或 Python。
- 免安装：解压即可运行，不写程序安装列表，不产生卸载入口。因此没有“卸载”概念，删除文件夹即移除程序。

## 数据位置（免安装 ≠ 数据随身带）

应用使用稳定标识 `com.cocarmytool.desktop`，Tauri 2 在 Windows 上把 WebView2 用户数据放在每用户本地 AppData（`AppData\Local`），桌面便携版与开发版共用同一目录，升级后旧数据仍然可见：

```text
%LOCALAPPDATA%\com.cocarmytool.desktop\EBWebView\Default\IndexedDB
```

配兵方案（Dexie/IndexedDB）和 WebView 数据都保存在该目录，不随便携文件夹携带；删除或移动 ZIP 解压目录不影响已保存的数据。请勿为“便携”而改动存储设计——数据始终走 Windows 标准 WebView/每用户 AppData 位置（按不变的应用标识隔离）。

## 发布前检查

```powershell
npm test
npm run build
npm run test:e2e
npm run release:portable
```

并在干净目录解压 ZIP 做一次启动烟雾测试：

1. 解压到仓库外的临时目录（例如 `%TEMP%\cocarmytool-smoke`）。
2. 确认目录内只有 `COCArmyTool.exe` 和 `使用说明.txt`。
3. 双击（或从该目录启动）`COCArmyTool.exe`，窗口应正常出现；此时工作目录不是仓库，且不依赖 Node/Vite/Cargo。
4. 验证 EXE 的版本信息为 0.3.0（`Get-Item .\COCArmyTool.exe | Select-Object VersionInfo`）。
5. 关闭窗口，确认进程退出。

## 版本一致性

发布前必须同时更新（见 `docs/MAINTENANCE.md` 第 8 节）：

- `package.json` 与 `package-lock.json`
- `src-tauri/tauri.conf.json`（`version` 与 `identifier` 同时在此维护）
- `src-tauri/Cargo.toml` 与 `Cargo.lock`
- 应用页脚等硬编码版本显示（`src/App.tsx`）

发布过程不涉及代码签名、自动更新、ARM64 或移动端支持；这些不在当前版本范围内。
