# 移动端 Web 适配评估（2026-08-27）

## 目标与范围

评估把 COCArmyTool 从"Windows 桌面优先、浏览器可用"推进到"手机浏览器 / PWA 上完整可用"所需的改造，覆盖安卓与 iOS。原生壳（Tauri 2 mobile / Capacitor）与微信小程序不在本评估范围内，另行立项。

结论先行：**当前代码库对移动端 Web 的就绪程度高于预期**。识别管线（onnxruntime-web 单线程 WASM + Web Worker）、本地存储（Dexie/IndexedDB）、路由级代码分割（识别页 lazy import）都不依赖桌面环境；Tauri 专属代码仅存在于 `src/utils/desktopImageDrop.ts` 且有 `isTauri()` 守卫。真正的改造集中在三类：识别审查流程在竖屏小屏上的交互重设计、模型下载的用户体验、触控目标与 PWA 细节。

## 现状盘点

已经具备的：

- 响应式断点已存在：`styles.css` 有 1120/1000/800/600/520/430px 多档断点，导航、编辑器网格、方案库双栏在窄屏都会折叠。
- 识别页的面板拖拽/四角缩放（`RecognitionOverlay.tsx`）基于 Pointer Events，且 `.recognition-crop-box` 已设 `touch-action: none`，触摸设备天然可用；卡片定位框是 `<button>`，可点按。
- 截图入口已有 `<input type="file" accept="image/png,image/jpeg,image/webp">`，移动端相册选择直接可用；拖放/粘贴只是增强路径。
- `vite.config.ts` 的 PWA 配置已将 27MB 模型与 wasm 排除出 precache，改用 CacheFirst 运行时缓存一年，首次访问不会下载模型。
- `index.html` 已有 viewport meta；`clipboard.ts` 在 `navigator.clipboard` 不可用时有 `execCommand` 降级。

主要缺口：

1. 识别审查流程（截图 → 候选核对）是为大屏设计的，竖屏手机上不可用或极难用（见下节，工作量最大）。
2. 模型下载无进度反馈、无失败重试指引，移动网络下 27MB 静默等待体验差。
3. 触控目标普遍偏小：stepper 按钮 25×28px、crop handle 20px、候选行按钮配 8px 字号，低于 44px 的移动端可点击性建议。
4. PWA 图标只有 SVG：iOS 不支持 SVG 作为 apple-touch-icon，需要 180×180 PNG；`theme-color`（#15243a）与木质主题背景（#2d211b）不一致。
5. 编辑器未保存守卫依赖 `beforeunload`，移动端浏览器和 iOS PWA 不保证触发。

## 分模块差距与改造项

### A. 识别审查流程（核心难点）

现状：`ScreenshotRecognitionPage` 的审查回路是"审查面板条目 ⇄ 原图上定位框"双向滚动定位。横屏截图在竖屏手机上渲染为约 390×220px，叠加框和卡片定位按钮的命中区域会缩到十几像素，基本不可点。

改造方案（按优先级）：

1. **识别阶段引导横屏**：截图本身是横屏的，审查时提示用户旋转手机（检测 `matchMedia('(orientation: portrait)')`），横屏下原图宽度约 800px，叠加框恢复可点。这是成本最低、收益最大的一步。
2. **补充捏合缩放**：给 `.recognition-image-stage` 增加双指缩放/平移（可用 Pointer Events 自实现，不引第三方库），让用户能放大到单卡片级别后点按定位框。
3. **放大候选命中区**：`recognition-card-box` 等叠加按钮增加最小命中尺寸（如 `min-width/min-height` + 透明 padding），不改变视觉边框。
4. **审查面板为主的移动交互**：小屏下把"点截图定位"降级为辅助，确认操作全部走 `RecognitionReviewPanel` 的列表条目（该面板在 600px 断点已是单列，结构可用，主要是放大字号与按钮）。

### B. 模型下载体验

- 识别启动时（`analyzeCardLayout` 首次触发 worker 建 session）展示分阶段进度：wasm 加载 → 分类器 6.5MB → OCR 21MB。onnxruntime-web 拉取模型走 fetch，可用 `fetch` + `ReadableStream` 包一层进度回调，或至少给出"预计 XX MB，首次约一分钟"的静态提示。
- 下载失败（弱网/中断）要给重试按钮而不是只留一条错误文案。
- 考虑增加"仅链接/编辑模式"说明：不进识别页就永远不下载模型，这一点目前架构已满足，但值得在 UI 上明示，管理用户对首屏体积的预期。

### C. 触控目标与可读性

- stepper（`CountEditor`）、crop handle、`candidate-row` 按钮统一提升到 ≥40px 命中区、字号 ≥12px；8-9px 字号在手机上不可读。
- hover 态（`.method-button:hover`、`.record-card:hover`）不阻断触摸，但选中态不能只靠 hover 表达，确认所有选中反馈都有 `.active/.selected` 类。

### D. PWA 与 iOS 细节

- 补 180×180 PNG apple-touch-icon；manifest 增加 192/512 PNG 图标（安卓安装提示需要）；修正 `theme-color` 为 #2d211b。
- iOS 上"添加到主屏幕"后的 standalone 模式需真机回归：IndexedDB 在安装后的 PWA 中不受 Safari 7 天不活跃清理影响，但浏览器标签页形态会——建议在方案库引导用户"添加到主屏幕"或定期 JSON 导出（导出功能已有）。
- `beforeunload` 守卫失效：编辑器脏状态离开确认改为应用内导航守卫（`canLeaveEditor` 已在 App 层，只需确认所有移动端退路都走它；PWA 直线返回手势无法拦截，接受即可）。

### E. 需真机验证的风险项（无法在桌面评估）

- iOS Safari 的 WASM 内存上限对 21MB OCR 模型 + 推理的影响；中端安卓上单线程 WASM 跑完整识别（约 70 张卡片分类 + 数量 OCR）的耗时。如果耗时超过用户可容忍范围，备选方案是评估 onnxruntime-web 的 WebGPU 后端（`executionProviders` 已参数化）——移动端 WebGPU 覆盖有限，只能作为渐进增强。
- iOS 相册 HEIC 截图（默认 iPhone 截图是 PNG，但用户可能传相册压缩图）是否被 preflight 拒绝，报错文案是否可指导。

## 样本收集（已决策实施，随阶段三落地）

目标：收集"机器识别与用户人工修正不一致"的截图作为训练样本——用户修正后的最终配兵即为标注，省去人工标注与"手机截图传电脑"的往返。

决策记录（2026-08-27）：使用者是知情的朋友圈范围，隐私承诺文案将同步修改为"开启样本共享后，截图与识别结果会上传到作者服务器"；配兵界面截图不含标签与部落信息，作者承诺不外泄样本。

数据设计：每条样本存四部分——

1. 原始完整截图（喂给现有 `recognition-samples/` 管线的就是完整截图，直接闭环）；
2. 机器候选快照（确认前的 `result`，含 top-3 候选与置信度）；
3. 用户确认后的最终配兵 JSON（`review.composition`）；
4. 元数据（应用版本、模型版本、preflight 摘要含 sha256 去重键、逐项 diff 标记哪些条目被修正）。

采集点：`ScreenshotRecognitionPage.confirmAllAndEnter()` 进入编辑器时——此时刻文件、候选、最终结果、preflight 全部在内存中，机器候选需在 `confirmAllCandidates` 改写前先做快照。

上传策略：opt-in 开关（设置项，默认关闭）+ IndexedDB 待传队列（Dexie 新表），网络失败自动重试，避免移动网络丢样本。接口用共享 token 防滥用，POST 到单一收集端点写入对象存储，不做账号体系。

后端形态（已选定，2026-08-27）：腾讯云函数 SCF + COS，API 网关触发器默认域名免备案。注意两点：SCF 免费额度已改为新用户前三个月需主动 0 元领取试用套餐包，之后按量计费（本量级每月几元以内）；2024 年起新建 COS 桶默认域名不能再对外提供网站服务，样本桶只做存储（读取走控制台/coscli）没有影响，但 Web 应用本身的托管需另选方案（如 CloudBase 静态网站托管，默认域名免备案自带 HTTPS）。

工作量估算：前端采集与队列 1-2 天，后端与导出 0.5-1 天。

前置准备清单（用户操作）：腾讯云账号 + 个人实名认证；创建私有读写 COS 样本桶；开通 SCF（同地域）；创建 CAM 子账号并授予 SCF + 目标桶写入的最小权限；生成共享 token 写入函数环境变量；本机可选装 Serverless Framework（代码化部署）与 coscli（样本导出）。

## 实施阶段建议

1. **阶段一（移动可用）**：A1 横屏引导 + A3/A4 命中区放大、B 模型下载提示与重试、C 触控目标与字号、D 图标与 theme-color。完成后安卓/iOS 浏览器可完整走通全流程。
2. **阶段二（体验完善）**：A2 捏合缩放、真机性能与内存回归（E）、按结果决定是否引入 WebGPU 渐进增强。
3. **阶段三（可选）**：样本收集后端，按上节最小形态实施，opt-in 默认关闭。

## 测试策略

- 现有 Playwright（Edge）基础上增加移动 viewport 用例（Pixel/PiPhone 尺寸 + `hasTouch`），至少覆盖：新建方案 → 编辑 → 保存；识别页选图 → 生成候选 → 确认 → 进入编辑器两条主链路。
- 单元测试不受影响（jsdom 环境与视口无关）。
- 真机清单：一台中端安卓 + 一台 iPhone，重点跑 E 节风险项。
