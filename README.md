# COCArmyTool

面向《部落冲突》国服 18 级大本营的本地配兵工具。它提供配兵链接解析与生成、截图辅助识别、完整性校验、热门方案浏览和本地方案管理，可作为 Windows 桌面应用或浏览器 PWA 使用。

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4)](#开发环境要求)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933)](#开发环境要求)

> 本项目是公开源代码的非商业社区工具，不是开放源代码（Open Source）软件。项目与 Supercell 或国服运营方无隶属、赞助或认可关系。

## 开发期间：双击打开桌面应用

当前项目仍处于开发阶段，根目录提供两个无需手工输入命令的 Windows 入口：

- `COCArmyTool 开发测试.lnk`：当前工作区已生成的本机推荐入口，带应用图标，直接双击。
- `COCArmyTool-开发测试.vbs`：可随仓库移动的通用入口，直接双击。

入口会在后台隐藏终端窗口，自动启动 Tauri 桌面开发版。应用关闭后后台开发进程会一并退出；修改前端代码时仍支持热更新。首次使用需要电脑已经安装 Node.js 22+、npm 和 Rust，项目依赖缺失时入口会自动执行 `npm install`。

启动日志位于 `artifacts/desktop-dev.stdout.log` 和 `artifacts/desktop-dev.stderr.log`。详细说明见 [Windows 开发测试入口](docs/WINDOWS_USAGE.md)。

## 桌面版基本操作

1. 双击 COCArmyTool 图标进入“新建方案”。
2. 选择导入分享链接、手工创建或截图识别。
3. 在统一编辑器中补齐主军、法术、攻城机器、援军和英雄配置。
4. 校验通过后复制国服链接，或保存到本机方案库。
5. 在“方案库”中通过 JSON 导出功能定期备份本地数据。

## 开发环境要求

| 用途 | 必需环境 |
| --- | --- |
| 网页版 | Node.js 22+、npm 11 或兼容版本 |
| 桌面开发/构建 | 网页版环境、Rust stable、Cargo、Microsoft Edge WebView2 |
| 端到端测试 | 上述 Node.js 环境和本机 Microsoft Edge |

开发者可以运行 `npm run check` 定位缺失项。

## 开发者任务入口

| 入口 | 行为 |
| --- | --- |
| `.\start.ps1` | 打开开发任务菜单 |
| `.\start.ps1 desktop` | 启动 Tauri 桌面开发版 |
| `.\start.ps1 web` | 启动 Vite 网页版 |
| `.\start.ps1 test` | 运行单元与组件测试 |
| `.\start.ps1 e2e` | 运行 Edge 端到端测试 |
| `.\start.ps1 build` | 构建网页版 |
| `.\start.ps1 desktop-build` | 构建 Windows NSIS 安装包 |
| `npm start` | 默认启动桌面开发版 |
| `npm run launcher` | 使用跨平台 Node.js 交互菜单 |

这些脚本用于开发、测试和构建，不是普通用户的应用启动入口。所有入口最终调用 `package.json` 中的标准脚本，避免文档、人工命令和 CI 使用不同流程。

## 主要功能

- 解析和生成国服 `CopyArmy` 分享链接。
- 校验主军、法术、攻城机器、援军、英雄、战宠和装备的 18 本完整性。
- 使用本地真实游戏图标展示和编辑军队配置。
- 通过 IndexedDB 在本机保存、编辑、备份和恢复方案，无账号、后端或云同步。
- 内置人工核验的近期配兵快照，并保留作者、来源和有效期。
- 在浏览器或桌面端本地处理完整横屏截图，提供 Top-3 候选和人工确认流程。
- 对识别结果设置安全门槛；未确认或不完整配置不能直接复制链接。
- 支持 PWA 离线缓存，也可构建 Tauri Windows 桌面安装包。

## 基本使用

### 导入分享链接

1. 在“新建方案”中选择链接导入。
2. 粘贴国服 `CopyArmy` 链接并解析。
3. 检查容量和英雄配置；不完整方案可继续编辑。
4. 填写名称、场景、标签和备注后保存。

### 手工创建配兵

1. 打开配兵编辑器。
2. 配置主军、法术、攻城机器、援军和四位英雄。
3. 根据状态栏补齐缺失容量、战宠或装备。
4. 校验通过后复制国服链接，或先保存为本地草稿。

### 截图辅助识别

1. 上传、拖放或粘贴完整横屏截图。
2. 运行真实识别，逐项检查候选和数量。
3. 人工确认所有项目，并补齐无法可靠识别的内容。
4. 容量、英雄规则和链接回环全部通过后再导出。

识别只在本机执行，不上传截图。当前承诺范围和限制见[截图识别说明](docs/screenshot-recognition.md)。

## 项目结构

```text
src/                  React 应用、领域逻辑、识别管线和本地存储
src-tauri/            Tauri 2 Windows 桌面壳
public/               PWA 资源和运行时游戏图标
scripts/              启动入口、数据生成、审计和样本处理脚本
e2e/                  Playwright 端到端回归
recognition-samples/  已分类的原始识别数据集、标签和元数据
docs/                 项目、维护、识别和审计文档
```

详细边界、数据流与兼容性约束见[项目说明](docs/PROJECT.md)，文档导航见[文档索引](docs/README.md)。

## 数据集

原始识别样本随仓库发布，但不会进入 Web/Tauri 生产构建。目录按用途分类：

- `batch-01-dev`：第一批开发和回归样本。
- `batch-02-request`：第二批覆盖驱动样本。
- `batch-02-blind`：算法冻结后的盲测占位与标签。
- `seed-unlabelled`：无标签布局种子，不计入准确率。
- `manual-tests`：特殊布局与故障复现夹具。

`reports/` 和 `derived/` 是可再生成产物，不提交 Git。采集格式、隐私要求和维护命令见[数据集说明](recognition-samples/README.md)。

## 验证与构建

```powershell
npm test
npm run test:e2e
npm run build
```

桌面端开发和安装包构建：

```powershell
npm run desktop:dev
npm run desktop:build
```

端到端测试默认使用 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；如安装路径不同，请调整 `playwright.config.ts`。

## 数据和隐私

- 配兵方案保存在当前应用来源对应的 IndexedDB 中。
- 清理浏览器/应用站点数据会删除本地方案，请定期从方案库导出 JSON 备份。
- 截图识别、模板匹配和数量分析均在本机完成。
- 数据库名和备份格式保留历史标识，以兼容旧版“COC 配兵助手”数据。

## 当前限制

- 只支持当前国服 18 本的固定容量和常驻单位。
- 国服内部 ID 仍需通过真实链接持续回归。
- 截图识别主要覆盖 iPhone 17 和 iPad Pro 2024 11 英寸已采样布局。
- 视觉近邻、图鉴未覆盖项和所有真实候选默认需要人工确认。
- 内置热门方案是随版本发布的人工快照，不是联网实时榜单。
- 当前没有账号、云同步、二维码、图片导出或一键唤起游戏功能。

## 参与维护

提交改动前请阅读[贡献指南](CONTRIBUTING.md)和[维护文档](docs/MAINTENANCE.md)。核心要求是：协议解析保持无损，合法性由独立校验层判断，界面不得绕过校验直接生成可复制链接。

## 许可和第三方素材

项目自有代码采用 [PolyForm Noncommercial License 1.0.0](LICENSE)，仅允许许可文本界定的非商业用途。任何商业使用都需要版权所有者另行书面授权。

`public/game-icons` 中的游戏图像、Clash of Clans/Supercell 名称和其他第三方素材不由本项目重新许可，也不自动受项目代码许可覆盖。来源、上游许可和使用边界见[第三方声明](THIRD_PARTY_NOTICES.md)。

最后核对：2026-08-24。
