# COCArmyTool 维护文档

本文面向项目维护者和贡献者，记录稳定入口、兼容性边界、数据更新、回归测试和发布流程。

## 1. 开发环境

### 基础环境

- Windows 10/11。
- Node.js 22 或更高版本，npm 11 或兼容版本。
- Rust stable 与 Cargo（仅桌面开发和构建需要）。
- Microsoft Edge 与 WebView2 Runtime。
- Python 3（仅截图样本预处理和模板提取需要）。

初始化：

```powershell
npm install
npm run check
```

统一入口：

```powershell
.\start.ps1
```

`start.ps1` 只负责定位项目根目录并调用 `scripts/start.mjs`；实际任务始终来自 `package.json`。增加或重命名脚本时，要同步更新启动器、README 和本文件。

## 2. 常用任务

| 任务 | 命令 | 输出/说明 |
| --- | --- | --- |
| 桌面开发 | `npm start` | Tauri 开发窗口，前端端口 1420 |
| 网页开发 | `npm run dev` | Vite 开发服务器 |
| 单元测试 | `npm test` | Vitest 全量运行 |
| 端到端测试 | `npm run test:e2e` | Playwright + 本机 Edge |
| 网页构建 | `npm run build` | `dist/` |
| 桌面安装包 | `npm run desktop:build` | `src-tauri/target/release/bundle/` |
| 游戏目录审计 | `npm run catalog:audit` | 名称、类别、图标和活动单位检查 |
| 样本审计 | `npm run samples:audit -- <批次>` | 批次 `reports/` |

`dist/`、`src-tauri/target/`、`reports/`、`derived/` 和 Playwright 输出都属于可再生成产物，不提交 Git。

## 3. 代码维护边界

### 链接协议

- `src/domain/armyLink.ts` 负责解析和生成。
- `src/domain/validation.ts` 负责容量和英雄规则。
- 修改内部 ID、区段语义或规范化顺序时，必须补充解析→生成→再解析测试。
- 不得因为当前 18 本规则而丢弃解析器读到的未知或不完整信息，除非协议层明确不支持。

### 数据兼容性

以下标识源自旧名称“COC 配兵助手”，属于持久化兼容接口，不能只为品牌统一而修改：

- IndexedDB 名称：`coc-army-assistant`。
- 备份格式：`coc-army-assistant-backup`。

若未来迁移，必须提供一次性迁移、旧格式导入测试和回滚说明。下载文件名可以使用新名称 `coc-army-tool-backup-YYYY-MM-DD.json`。

### 截图识别安全门槛

- 真实识别候选默认未确认。
- 不得用“高置信度”直接替代人工确认，除非产品范围和测试基线明确变更。
- 面板定位、卡片切分、数量、英雄装备归属和最终容量要分层记录错误。
- 识别失败应返回可编辑候选或明确提示，不能生成看似合法但未经确认的链接。

## 4. 静态游戏数据更新

应用运行时不依赖网络或 Python 上游包。更新流程：

1. 获取新版 `clashy.py` 的 `coc/static/static_data.json`。
2. 设置源文件路径并生成裁剪数据：

   ```powershell
   $env:COC_STATIC_DATA_PATH='C:\path\to\static_data.json'
   npm run generate:data
   ```

3. 运行 `npm run catalog:audit`。
4. 审查 `scripts/catalog-overrides.mjs`，不要直接在生成 JSON 中隐藏上游错误。
5. 补齐 `src/data/localization.zh-CN.ts` 和 `public/game-icons`。
6. 添加或更新真实国服链接回归样例。
7. 运行单元测试、端到端测试和生产构建。

任何第三方来源变化都要同步更新 `THIRD_PARTY_NOTICES.md`。

## 5. 识别数据集维护

### 目录约定

```text
recognition-samples/<批次>/
  images/          原始、未裁剪样本（提交 Git）
  labels.txt       UTF-8 Tab 分隔标签（提交 Git）
  metadata.json    可选设备/面板元数据（提交 Git）
  derived/         可再生成格式和缩放变体（忽略）
  reports/         审计与评估输出（忽略）
```

特殊问题复现放在 `recognition-samples/manual-tests`，并使用描述性文件名和 README 说明。不要在测试中引用微信缓存、下载目录或个人绝对路径。

### 处理流程

```powershell
npm run samples:audit -- recognition-samples/batch-01-dev
npm run samples:preprocess -- recognition-samples/batch-01-dev
npm run samples:extract-templates -- --batch recognition-samples/batch-01-dev
npm run samples:variants -- recognition-samples/batch-01-dev
```

合并多批模板：

```powershell
npm run samples:merge-templates -- <第一批.json> <第二批.json> --output src/data/recognitionTemplates.generated.json
```

提交前确认：

- 原图和标签一一对应，哈希无重复。
- 设备字段使用稳定代号，不记录不必要的个人信息。
- 截图没有聊天、通知或其他不应公开的信息。
- 生成产物没有误入 Git。
- 盲测集未参与模板选择或阈值调节。

## 6. 热门方案快照

`src/data/featuredArmies.ts` 只保存必要的结构化配兵和简短摘要。更新要求：

1. 原文可核验发布日期和完整分享链接。
2. 采集时发布时间不超过项目定义的有效期。
3. 链接通过容量、英雄配置和回环测试。
4. 保留作者、原文、发布、采集和到期日期。
5. 到期内容显示“待复核”，不能继续宣称为近期方案。

不要镜像原视频、文章或创作者图片。

## 7. 测试策略

每次发布至少执行：

```powershell
npm test
npm run test:e2e
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

变更与验证的最低对应关系：

| 变更 | 必需验证 |
| --- | --- |
| 链接协议或单位 ID | 领域测试、回环测试、真实国服样例 |
| 容量/英雄规则 | 校验测试、编辑器组件测试、端到端导出门槛 |
| IndexedDB/备份 | 存储测试、旧备份导入、冲突合并 |
| 截图布局或模板 | 对应批次审计、原始样本和变体 E2E |
| 启动/构建配置 | `npm run check`、帮助输出、Web 构建、Cargo check |
| UI 流程 | 相关组件测试和 Playwright 主流程 |

测试失败时不要先更新期望值；先判断实现是否破坏协议、兼容性或安全门槛。

## 8. 版本与发布

项目版本必须同时更新：

- `package.json` 与 `package-lock.json`。
- `src-tauri/tauri.conf.json`。
- `src-tauri/Cargo.toml` 与 `Cargo.lock`（若 Cargo 元数据变化）。
- 应用页脚或其他硬编码版本显示。

发布检查：

1. 工作区只包含预期改动。
2. README、项目说明、维护文档和第三方声明仍准确。
3. 数据集无重复、无隐私信息、无生成产物。
4. 运行完整验证矩阵。
5. 构建 Windows 安装包并在干净环境做一次启动烟雾测试。
6. 创建带版本号的 Git 标签和发行说明。
7. 二进制放 GitHub Release，不提交到 Git 历史。

开发阶段的图形测试入口是根目录的 `COCArmyTool-开发测试.vbs`，它调用 `scripts/dev-launcher.ps1` 并在隐藏窗口中运行 `npm run desktop:dev`。本机可创建带图标的 `.lnk` 快捷方式；由于快捷方式包含绝对路径，不提交 Git。正式发布阶段再生成安装包和便携 EXE。

## 9. 依赖与安全

- 定期审查 `npm outdated`、`npm audit` 和 `cargo outdated`（若已安装）。
- 锁文件必须随依赖变更提交。
- 不提交令牌、账号配置、`.env`、日志或本机路径。
- 外部链接、热门方案和素材来源应使用最小必要数据，并记录出处。
- PolyForm 非商业许可只覆盖版权所有者有权许可的项目自有软件；第三方素材以各自权利为准。

## 10. 常见故障

### `start.ps1` 被执行策略阻止

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

### 桌面版提示缺少 Rust

安装 Rust stable，重新打开终端后运行 `npm run check`。

### Playwright 找不到 Edge

检查 `playwright.config.ts` 中的 `executablePath`，改为本机实际安装位置。

### 本地方案不见了

确认启动来源和端口是否变化。IndexedDB 按来源隔离；桌面 WebView、Vite 默认端口和预览端口的数据不会自动共享。使用方案库 JSON 备份迁移。

最后核对：2026-08-24。
