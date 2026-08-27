# 右侧军队卡片模型与 OCR 集成实现方案

> 日期：2026-08-25  
> 状态：待实施  
> 范围：主兵种、主法术、攻城机器、部落城堡援军四个右侧区域  
> 不在本轮范围：面板检测模型、英雄、装备、战宠识别

## 1. 文档目的

本文档规划将右侧四个军队卡片区域由当前的模板匹配和数字位图识别，迁移为：

```text
现有面板定位与标准画布
  -> 现有区域投影与卡槽分割
  -> 单卡 160×160 标准化
  -> 76 类 ONNX 分类模型
  -> 根据区域过滤类别
  -> 左上角 xN 角标定位
  -> 预训练 OCR 识别数量
  -> 容量、重复类别与链接规则仅做校验
  -> 人工确认与配兵编辑器
```

本轮目标不是重新设计整条截图识别链路，而是替换已经形成单卡候选框之后的两个识别器，降低图标相似、背景颜色、裁剪宽度、数量模板不均衡等因素造成的波动。

## 2. 已确认结论

### 2.1 类别分类模型

- 模型：`artifacts/army-card-classifier-cn-v2.onnx`
- 模型结构：YOLO26n-cls
- 输入：`float32[1, 3, 160, 160]`
- 输出：`float32[1, 76]`，已经是概率，约等于 1 的总和，不得再次执行 Softmax
- 文件大小：6,524,385 字节，约 6.22 MiB
- SHA-256：`F01EA7454C3C24E8588205C8B6A6F821719FBE8C094B3A6D79FEE69D7569D358`
- 数据范围：49 个兵种、18 个法术、9 个攻城机器，共 76 类
- 真实验证集：455 张卡片、21 个原始截图组
- 区域约束 Top-1：451/455，99.12%
- 主兵种：149/149
- 主攻城机器：58/58
- 主法术：110/112
- 援军区：134/136
- PT 与 ONNX 在 455 张验证卡片上的 Top-1 完全一致

模型是闭集分类器，不包含“无效”“未知”或“其他”类别。只要卡槽被确认存在，分类阶段必须输出 76 个合法类别之一。

### 2.2 数量 OCR

- 基线引擎：RapidOCR 3.9.2 的 PP-OCRv6 small recognition ONNX
- 只使用文字识别模型，不使用文字检测模型和方向分类模型
- OCR 模型输入：`float32[N, 3, 48, dynamic-width]`
- OCR 模型输出：CTC 序列，字符表内嵌在 ONNX 元数据中
- 文件大小：约 20.25 MiB
- 上游模型 SHA-256：`6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884`
- 不使用项目数量数据训练新模型
- 不使用容量约束的真实基线：454/455，99.78%
- 唯一不一致项的图片实际显示 `x2`，OCR 三种预处理均识别为 `x2`；验证卡片被标成了链接中数量为 1 的召回法术，属于卡片标签/卡槽对应问题，不是 OCR 读数错误
- 按图片可见数字计算：455/455

当前数量验证值只覆盖 `1、2、3、4、5、6、7、8、9、10、13、17`。上线前仍需补充 `20～99` 中游戏内可能出现的两位数回归样本。

### 2.3 已验证的关键条件

通用 OCR 不能直接在原始截图的固定绝对位置读取。未先定位角标时，原图固定比例裁剪只有 74/455，16.26%，其中 307 张没有得到有效数字。

达到稳定结果必须满足：

1. 先定位面板与功能区域；
2. 先形成单张卡片候选框；
3. 将卡片按训练规则标准化；
4. 在卡片顶部通过白字连通域定位 `xN`；
5. 只把紧凑的 `xN` 行送入 OCR recognition 模型。

## 3. 改造范围与非目标

### 3.1 本轮改造范围

- `mainTroops`：主兵种，只允许 `troop`
- `mainSpells`：主法术，只允许 `spell`
- `mainSiege`：攻城机器，只允许 `siege`
- `castleArmy`：援军混排，允许 `troop`、`spell`、`siege`
- 四区域的单卡类别识别
- 四区域的单卡数量识别
- 模型加载、缓存、错误降级、诊断数据和回归测试
- 容量与重复类别规则从“自动改写”调整为“校验和告警”

### 3.2 本轮明确不处理

- 不训练新的类别模型
- 不训练数字分类模型
- 不增加目标检测模型寻找单卡
- 不改变英雄、装备和战宠现有识别方式
- 不把英雄图标加入 76 类模型
- 不拆分为四个区域模型
- 不增加未知类别
- 不用数量反推卡片类别
- 不处理面板完全缺失、弹窗严重遮挡或任意旋转截图

## 4. 目标架构

### 4.1 端到端流程

```text
File
  -> inspectScreenshotFile
  -> createStandardRecognitionImage（2160×1120）
  -> projectLayoutToPanel
  -> detectCardSlots
  -> 对每个卡槽执行：
       A. normalizeArmyCardCrop -> 160×160 RGB
       B. classifyArmyCard -> 76 类概率
       C. constrainClassProbabilitiesByRegion -> Top-3/Top-8
       D. locateCountBadge -> 紧凑 xN 图像
       E. recognizeArmyCardCount -> OCR 文本、数字和置信度
  -> 只删除有明确结构证据的尾部伪卡槽
  -> validateDuplicateItems / validateCapacity
  -> createVisualRecognitionResult
  -> 人工确认
```

面板和卡槽分割继续提供几何位置；分类模型和 OCR 不反向改变卡槽坐标。数量角标仍可作为卡槽存在性的辅助视觉证据，但 OCR 读出的具体数值不得参与卡槽检测。

### 4.2 模块职责

| 模块 | 职责 | 是否改动类别或数量 |
| --- | --- | --- |
| `panelLocator.ts` / `preflight.ts` | 找到配兵面板 | 否 |
| `imageNormalization.ts` | 生成标准面板画布 | 否 |
| `layouts.ts` | 投影四个右侧区域 | 否 |
| `cardDetector.ts` | 生成卡槽，定位白字连通域 | 只提供几何证据 |
| 新 `armyCardCrop.ts` | 单卡 160×160 标准化 | 否 |
| 新 `armyCardClassifier.ts` | ONNX 类别推理与区域过滤 | 是，类别唯一主来源 |
| 新 `armyCountOcr.ts` | 定位 `xN`、OCR、CTC 解码 | 是，数量唯一主来源 |
| `countConstraints.ts` | 容量与重复检查 | 改为告警，不静默覆盖 |
| `templateMatcher.ts` | 旧类别模板 | 仅降级使用 |
| `countRecognizer.ts` | 旧数字位图 | 仅降级或诊断使用 |

## 5. 模型资源与运行时

### 5.1 计划新增的发布资源

实施时将经过校验的模型复制到版本化路径，不从 Python 虚拟环境或 `artifacts` 直接读取：

```text
public/models/army-card-classifier-cn-v2.onnx
public/models/army-card-classes-cn-v2.json
public/models/army-count-ocr-ppocrv6-small-v1.onnx
public/models/army-count-ocr-charset-v1.json
public/models/recognition-model-manifest.json
```

`recognition-model-manifest.json` 至少保存：

- 逻辑名称与模型版本；
- 文件名；
- SHA-256；
- 输入输出名称和形状；
- 类别或字符表版本；
- 预处理版本；
- 训练/上游来源；
- 许可证与 NOTICE 路径。

类别映射和 OCR 字符表应由脚本从 ONNX 元数据导出为 JSON，不能手工维护两个可能漂移的列表。构建前检查类别数必须为 76，OCR 输出宽度必须与字符表长度一致。

### 5.2 ONNX Runtime

前端增加 `onnxruntime-web`，Web、PWA 和 Tauri WebView 共用 WASM 执行后端：

- 第一版固定 `executionProviders: ['wasm']`，优先保证跨环境一致；
- 不在第一版启用 WebGPU，避免不同显卡和浏览器带来的算子与精度差异；
- 在专用 Web Worker 中创建并复用两个 `InferenceSession`；
- 默认单线程 WASM，避免 PWA 因 COOP/COEP 不满足而无法启用多线程；
- 后续可以在能力检测通过后启用 SIMD 或多线程，但必须重新执行 ONNX 一致性测试；
- 每个模型只初始化一次，不允许每张卡片重复创建 session。

### 5.3 加载和缓存策略

- 打开截图识别页面时不立即下载模型；用户首次开始真实识别时懒加载；
- Tauri 安装包包含模型文件，断网也可加载；
- PWA 对版本化模型 URL 使用 Cache First，首次成功加载后可离线使用；
- 大模型不加入普通首屏资源，避免拖慢整个应用启动；
- 加载期间显示“正在加载卡片分类模型/数量 OCR”，不能让页面表现为无响应；
- 模型文件加载或校验失败时使用旧模板链路，并明确显示“已降级为旧识别器”；
- 模型升级通过新文件名和 manifest 版本完成，不覆盖同名缓存文件。

## 6. 单卡分类实现细节

### 6.1 单卡裁剪必须与训练一致

对 `detectCardSlots` 返回的卡槽：

1. 从 2160×1120 标准面板画布裁出卡槽；
2. 按裁片高度缩放到 160 像素；
3. 保持宽高比，不横向拉伸；
4. 缩放后宽度超过 160 时保留左侧 160 像素；
5. 宽度不足 160 时左对齐；
6. 右侧使用训练/验证一致的 RGB `(57, 64, 71)` 填充；
7. 输出 `RGB -> CHW -> float32 / 255`；
8. 不执行均值方差标准化，不执行二次 Softmax。

必须用同一组金样本验证浏览器 Canvas 标准化结果与 Python `normalize_crop` 的差异。允许因 Lanczos 和浏览器插值实现不同存在小像素差，但 ONNX Top-1 必须保持一致。

### 6.2 类别后处理

模型输出顺序以 `army-card-classes-cn-v2.json` 为唯一依据。区域过滤在概率上执行：

```text
mainTroops -> 只保留 troop_*
mainSpells -> 只保留 spell_*
mainSiege  -> 只保留 siege_*
castleArmy -> 保留全部 76 类
```

过滤后对允许类别概率重新归一化，再排序输出：

- 三个主区域保留 Top-3；
- 援军区保留 Top-8，供人工纠正和混排调试；
- Top-1 始终是允许集合内的合法类别；
- 分数语义为区域条件下的相对概率，不将它宣称为绝对正确率。

不设置“低于阈值则无效”。低分只影响是否允许一键确认，并在界面显示需要核对。

### 6.3 重复类别

同一区域通常不会显示同一类别两次，但第一版不能因为出现重复 Top-1 就静默把其中一张换成 Top-2。

新的处理方式：

- 保留每张卡片的模型 Top-1；
- 标记“同一区域出现重复类别，请核对”；
- 在候选列表中展示不重复的替代项；
- 只有用户确认或后续建立有真值证明的确定性规则后才改写结果。

## 7. 数量 OCR 实现细节

### 7.1 角标定位

复用 `findWhiteGlyphComponents` 的白字标准：

```text
max(R,G,B) >= 195
max(R,G,B) - min(R,G,B) <= 95
```

在卡片顶部约 30% 高度内：

1. 寻找尺寸和面积符合游戏 `x` 字符的连通域；
2. 要求其右侧 12～45 个缩放像素内存在数字连通域；
3. 从 `x` 向右收集最多两个连续数字；
4. 将 `x` 与数字的联合框向外扩展少量像素；
5. 如果窄卡裁剪保留了前一张卡片边缘，允许角标出现在卡片内部，而不是强制从 `x=0` 开始；
6. 找不到 `x` 时可以使用固定顶部 ROI 做一次 OCR 降级，但不得用固定 ROI 结果覆盖已成功定位的角标。

该步骤只做文字行定位，不判断数字类别。

### 7.2 OCR 预处理

第一版严格复现已验证基线：

1. 紧凑角标裁片保持比例放大到 128 像素高；
2. OCR 输入再保持比例缩放到 48 像素高；
3. 宽度按比例动态确定并右侧补零；
4. BGR/RGB 通道顺序必须通过 Python 对照样本确认；
5. 转为 `CHW float32`；
6. 除以 255；
7. 减 0.5；
8. 再除以 0.5，使数值落在约 `[-1, 1]`。

先运行原彩色版本。只有 OCR 未产生 1～2 位有效数字或分数低于待校准阈值时，才追加灰度/轻度对比度版本，避免每张卡片固定执行三次推理。

### 7.3 CTC 解码和数量解析

- 从模型元数据导出的字符表执行 CTC greedy decode；
- 去掉 blank；
- 合并连续重复字符；
- 保留 OCR 原始文本用于调试；
- 最终只提取 ASCII 数字；
- 接受 `x1`、`X1`、`×1` 或只有数字的文本；
- 有效数量为 1～99；
- 超过两位、等于 0、没有数字或包含无法消解的结果均视为未识别；
- 不输出“无效数量”值，未识别时 `value` 保持空并要求人工填写。

OCR 第一版使用 greedy Top-1。若后续确实需要多个数量候选，再实现限定在 `x/X/×/0～9` 字符集合上的窄束搜索，不从通用字符表生成大量无关候选。

### 7.4 容量约束

当前 `constrainCountsToCapacity` 会选择 OCR 候选甚至补全完全未读出的数量。本轮改造后默认行为调整为：

- OCR 读到什么就保留什么；
- 容量规则只标记总容量不足、超出或不一致；
- 数学上存在唯一可能值时可以在界面显示“建议数量”，但不能静默覆盖 OCR 值；
- OCR 无结果时不直接填入容量推断值；
- 类别候选和数量候选不互相改写。

这样可以区分“视觉识别结果”和“游戏规则推断结果”，避免错误类别导致数量被错误修正。

## 8. 接口与数据结构

建议保留现有 UI 所需字段，并增加来源与诊断信息：

```ts
interface ArmyCardClassCandidate {
  id: number
  kind: 'troop' | 'spell' | 'siege'
  className: string
  score: number
  rawScore: number
}

interface ArmyCardClassification {
  candidates: ArmyCardClassCandidate[]
  source: 'onnx' | 'legacy-template'
  modelVersion: string
  preprocessingVersion: string
}

interface ArmyCardCountRecognition {
  value?: number
  confidence: number
  rawText: string
  badgeRect?: NormalizedRect
  source: 'ppocrv6' | 'legacy-bitmap' | 'none'
  preprocessingVariant: 'raw' | 'gray' | 'contrast' | 'none'
}

interface DetectedCardSlot {
  rect: NormalizedRect
  badgeConfidence: number
  candidates?: ArmyCardClassCandidate[]
  classification?: ArmyCardClassification
  count?: ArmyCardCountRecognition
  diagnostics?: string[]
}
```

为了减少一次性改动，`candidates` 和 `count.value/confidence` 保持兼容，新增字段先供日志、调试界面和测试使用。

## 9. 代码改动清单

### 9.1 新增文件

| 文件 | 内容 |
| --- | --- |
| `src/recognition/modelManifest.ts` | 模型路径、版本、哈希和元数据类型 |
| `src/recognition/recognitionWorker.ts` | Worker 内创建 ONNX sessions 并串行执行推理 |
| `src/recognition/recognitionWorkerClient.ts` | 主线程请求队列、超时、取消和错误映射 |
| `src/recognition/armyCardCrop.ts` | 160×160 单卡标准化与张量转换 |
| `src/recognition/armyCardClassifier.ts` | 类别推理、类别映射和区域过滤 |
| `src/recognition/armyCountOcr.ts` | 角标定位、OCR 预处理、CTC 解码和数字解析 |
| `scripts/prepare-recognition-model-assets.py` | 复制模型、导出元数据、生成 manifest 和校验哈希 |
| `src/recognition/armyCardClassifier.test.ts` | 分类预处理与后处理单元测试 |
| `src/recognition/armyCountOcr.test.ts` | 角标定位、CTC 和数字解析单元测试 |

### 9.2 修改文件

| 文件 | 修改 |
| --- | --- |
| `package.json` | 增加 `onnxruntime-web` 和模型资源准备/一致性测试命令 |
| `vite.config.ts` | 配置 WASM 资源和 PWA 模型运行时缓存 |
| `src/recognition/cardAnalysis.ts` | 将同步模板/位图调用改成异步模型与 OCR 调用 |
| `src/recognition/cardDetector.ts` | 保留分割逻辑，抽出可复用角标几何证据 |
| `src/recognition/countConstraints.ts` | 从自动改写改为校验和建议 |
| `src/recognition/types.ts` | 增加模型/OCR来源和诊断字段 |
| `src/recognition/visualEngine.ts` | 展示模型候选、OCR值和规则告警，不混淆来源 |
| `src/pages/ScreenshotRecognitionPage.tsx` | 展示模型加载、推理进度、降级状态和错误 |
| `src/components/RecognitionReviewPanel.tsx` | 展示 OCR 原文、模型候选及容量建议 |
| `e2e/*.spec.ts` | 更新真实识别断言与模型加载等待逻辑 |

### 9.3 保留但降级的文件

- `templateMatcher.ts`：模型不可用时的类别降级路径，以及迁移期 A/B 对照
- `countRecognizer.ts`：OCR 不可用时的数量降级路径，以及迁移期诊断

在新链路通过完整回归以前不删除旧实现。

## 10. 异步执行与稳定性

### 10.1 调度

分类 ONNX 固定 batch=1，第一版按卡槽顺序串行推理。OCR 模型虽然支持动态 batch，但不同角标宽度会增加补齐和对照复杂度，第一版同样串行执行。

允许的优化顺序：

1. 分类和 OCR 两个 session 初始化并行；
2. 同一卡槽的分类与 OCR 在不同 session 上并行；
3. 每个 session 内保持单一队列，避免多个 `run()` 同时竞争 WASM 内存；
4. 页面更换截图或组件卸载时取消未开始任务，忽略已过期结果。

### 10.2 错误与降级

- manifest 或类别数不正确：禁止使用新模型，整体降级；
- 分类模型加载失败：类别使用旧模板，OCR 仍可继续；
- OCR 模型加载失败：数量使用旧位图识别，分类模型仍可继续；
- 单卡分类输出非有限值或形状错误：该卡使用模板降级；
- 单卡 OCR 没有有效数字：数量留空，不伪造结果；
- 降级结果必须在数据结构和界面中标明来源；
- 模型错误不能使整个页面崩溃或丢失已经完成的卡槽分割。

## 11. 分阶段实施计划

### 阶段 A：准备可发布模型资源

1. 增加模型资源准备脚本；
2. 复制类别与 OCR recognition ONNX；
3. 导出 76 类名称和 OCR 字符表；
4. 生成 manifest、SHA-256 和许可证文件；
5. 验证构建产物包含所需模型；
6. 验证 PWA/Tauri 能通过相同 URL 加载。

完成条件：两份 ONNX 和元数据在开发、生产预览、Tauri 中均可读取，哈希和输入输出形状正确。

### 阶段 B：集成类别分类模型

1. 增加 ONNX Runtime Worker；
2. 实现单卡 160×160 标准化；
3. 实现类别映射和区域过滤；
4. 在 `cardAnalysis.ts` 中以新模型替换 `rankCardTemplates` 主路径；
5. 保留模板结果用于降级和调试对比；
6. 在 455 张验证卡片上执行浏览器 ONNX 一致性测试。

完成条件：浏览器端 Top-1 与 Python ONNX 在 455 张卡片上一致，区域指标不低于已记录基线。

### 阶段 C：集成数量 OCR

1. 从 `cardDetector.ts` 抽出角标定位；
2. 实现 PP-OCRv6 预处理与 CTC 解码；
3. 只解析 1～2 位数字；
4. OCR 失败时按需尝试灰度/对比度变体；
5. 保留旧数字位图降级路径；
6. 将 OCR 原文、置信度和角标框加入调试输出；
7. 在 455 张数量样本上执行浏览器与 Python 对照。

完成条件：按现有链接真值至少达到 454/455；已知错标样本单独记录，不通过篡改 OCR 结果迎合错误标签。

### 阶段 D：解除识别与规则推断耦合

1. `constrainCountsToCapacity` 改为返回问题与建议，不改写数量；
2. 重复类别规则改为告警，不自动替换 Top-1；
3. `visualEngine.ts` 分别展示视觉结果和规则建议；
4. 一键确认只接受满足确认门槛的模型/OCR结果；
5. 低置信或规则冲突项保留人工确认。

完成条件：调试数据可以明确区分“模型类别”“OCR数量”“容量建议”和“用户最终确认”。

### 阶段 E：端到端回归与发布

1. 跑现有 unit、Vitest、Playwright 和 `npm run check`；
2. 跑 21 个原始截图组；
3. 跑 `recognition-samples/test_data` 和视频压缩回归集；
4. 在浏览器生产预览和 Tauri 开发包各跑一次；
5. 记录冷启动、模型加载、单卡推理和整图推理时间；
6. 验证断网后的 PWA 缓存与 Tauri 离线识别；
7. 新链路稳定后再决定是否删除旧模板主路径。

完成条件：功能指标、性能指标和降级路径全部通过，旧识别器仍可通过开关回退一个版本周期。

## 12. 测试方案与验收门槛

### 12.1 单元测试

- 单卡窄裁剪保持比例、左对齐、右填充；
- 超宽裁剪从右侧截断，不丢失左上数量和主体左侧；
- RGB/CHW/归一化顺序正确；
- 模型输出不重复 Softmax；
- 四区域允许类别集合正确；
- OCR 可解析 `x1`、`X10`、`×17`、`9`；
- OCR 拒绝空文本、0、三位数和无数字文本；
- CTC blank、重复字符和字符表索引正确；
- 角标不在绝对左边时仍能定位；
- 前一张卡片残留不会被当作当前数量；
- 模型失败只触发对应识别器降级。

### 12.2 模型一致性测试

| 项目 | 门槛 |
| --- | --- |
| 分类 ONNX 结构检查 | 通过 |
| 浏览器与 Python 分类 Top-1 | 455/455 一致 |
| 分类区域约束 Top-1 | 不低于 451/455 |
| 数量 OCR 链接真值 | 不低于 454/455 |
| 数量 OCR 未读出数量 | 0/455 |
| 主兵种数量 | 149/149 |
| 主法术数量 | 112/112 |
| 主攻城数量 | 58/58 |

已知 `spell_053_recall_spell/635b10cada6a090f.png` 的可见图标和 `x2` 与当前类别/链接映射不一致，应作为数据质量问题修正或单列，不得用容量规则把 OCR 的 `2` 改成 `1`。

### 12.3 卡槽和端到端测试

- 四区域卡槽数量不能比当前基线减少；
- 主区域第一张和最后一张召回率不能回退；
- 援军窄卡片不能合并成一张；
- 同一张截图多次运行结果必须一致；
- 模型首次加载失败、断网、缓存损坏均有可见降级结果；
- 用户切换图片时旧推理结果不得写入新图片；
- 最终配兵链接必须继续通过现有链接回环和容量校验。

### 12.4 性能记录

第一版先记录而不是通过牺牲正确率优化：

- 类别模型下载大小与加载时间；
- OCR 模型下载大小与加载时间；
- Worker 初始化时间；
- 单卡分类时间；
- 单卡 OCR 时间；
- 一张完整截图的总识别时间；
- 峰值内存；
- 浏览器主线程最长阻塞时间。

UI 主线程不得执行 ONNX 推理。识别期间必须持续显示进度，并允许用户更换图片或返回其他页面。

## 13. 功能开关与回滚

迁移期保留三个内部开关：

```ts
cardClassifier: 'onnx' | 'template'
countRecognizer: 'ppocrv6' | 'bitmap'
ruleApplication: 'warn-only' | 'legacy-auto-correct'
```

默认发布顺序：

1. 开发环境启用 `onnx + ppocrv6 + warn-only`；
2. 回归通过后在生产默认启用；
3. 保留旧路径至少一个版本周期；
4. 发生模型加载、兼容性或性能问题时可分别回退类别或数量，不要求整体回退。

## 14. 已知风险与后续数据需求

### 14.1 分类数据风险

- 真实验证集只有 21 个原始截图组，不能代表所有国服设备、录屏和压缩来源；
- 已发现至少一张援军法术存在图标、类别和链接数量错位，修正后应重新计算类别指标；
- 新兵种、新法术、新攻城机器上线时必须更新类别映射、数据集和模型，不能只更新前端游戏数据。

### 14.2 数量数据风险

- 当前真实数量主要为 1，数字分布不均衡；
- `9`、`10`、`13`、`17` 样本很少；
- 尚未真实验证 `20～99` 的常见兵种数量；
- 后续补样应优先包含 `20、25、30、35、40、45、50` 以及模糊、缩放和微信压缩版本；
- 补样只用于回归，不需要因此立即训练数字模型。

### 14.3 发布体积

类别与 OCR 模型合计约 26.5 MiB，另有 ONNX Runtime WASM。应通过懒加载、版本化缓存和 Worker 控制首屏与内存影响。若 OCR 体积成为实际问题，再评估英文/数字更小的预训练 recognition 模型；不能在没有等价回归结果前仅为减小体积替换已经验证的 PP-OCRv6 small。

### 14.4 上游许可证

分发 OCR 模型和运行库前必须将对应许可证和 NOTICE 纳入发布资源，并在模型 manifest 中记录来源与版本。模型准备脚本应拒绝来源、哈希或许可证信息缺失的资源。

## 15. 最终完成定义

只有同时满足以下条件，本轮改造才算完成：

- 四个右侧区域的类别主路径已经使用 `army-card-classifier-cn-v2.onnx`；
- 数量主路径已经使用 PP-OCRv6 recognition ONNX；
- 浏览器、PWA 和 Tauri 使用同一套预处理、后处理和模型版本；
- 分类浏览器结果与 Python ONNX 验证结果一致；
- 数量 OCR 达到已记录的 454/455 基线，且没有未读出样本；
- 区域约束只过滤不可能类别，不产生无效类别；
- 容量和重复规则不再静默改写视觉结果；
- 模型加载失败时可以分别降级到旧类别模板或旧数字位图；
- 旧英雄、装备、战宠识别没有被本轮改动影响；
- 全部单元、端到端、生产构建和 Tauri 回归通过；
- 文档、模型 manifest、哈希、许可证和回滚开关齐全。

