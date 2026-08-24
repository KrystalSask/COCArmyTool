# 截图配兵识别：样本前置架构

## 当前状态

第一批 13 张样本已经接入真实浏览器识别管线。页面会执行面板定位、卡片分割、Top-3 图标候选、专用数量识别、装备/战宠匹配、装备归属英雄推断和大守护者模式识别；所有真实候选默认仍需人工确认。

“运行模拟识别”仅作为页面和安全门槛的回归入口保留；正常验收请使用“生成真实识别候选”。

官方/开源能力调查、复用取舍、评估指标和长期验收门槛见 `docs/screenshot-recognition-implementation-goal.md`。

## 固定范围

- 当前国服 18 级大本营。
- 完整、未裁剪的横屏全局截图。
- `saved`：我的军队 / 已保存配置。
- `edit`：编辑导入的军队配置。
- 不处理不完整截图；关键面板缺失时要求重新上传。
- 忽略英雄、兵种、法术和攻城机器等级。
- 不识别英雄立绘和皮肤。
- 英雄由两件装备的共同归属推断。
- 战宠独立识别。
- 大守护者通过卡片右上角标志识别地面/空中模式。
- 全部图片默认只在浏览器本地处理。

## 管线

1. 检查格式、分辨率和横屏比例。
2. 计算本地 SHA-256，用于样本追踪和重复检测。
3. 通过页面类型控件和木质面板像素判断 `saved` / `edit`。
4. 按布局定义提取有效面板、容量/页面锚点、主部队、主法术、主攻城、援军混排行和英雄区域。
5. 在区域内检测卡片，类别由区域约束。
6. 图标候选只与对应类别的本地真实图标比较，并返回 Top-3 与置信度。
7. 数量识别只处理左上角 `x0123456789`；左下角等级区域屏蔽。
8. 使用装备归属推断英雄，并单独识别战宠与大守护者模式。
9. 黄色/红色项目必须由用户核对；可切换候选、修改数量并定位原图。
10. 复用现有六项容量、英雄、宠物和装备校验。
11. 生成链接后再次解析，并与确认配置标准化比较。
12. 只有完整截图、零待确认项、规则有效和链接回环一致同时通过时才允许复制链接。

## 代码边界

- `src/recognition/types.ts`：识别结果、候选、区域和引擎接口。
- `src/recognition/layouts.ts`：两类页面的归一化面板、锚点和区域。
- `src/recognition/preflight.ts`：图片读取、格式/尺寸检查、摘要和布局初判。
- `src/recognition/panelLocator.ts`：设备画像、面板初始窗口和像素边缘细化。
- `src/recognition/cardDetector.ts`：`x数量` 字形锚点与卡片分割。
- `src/recognition/templateMatcher.ts`：截图原生模板、区域约束和 Top-3 匹配。
- `src/recognition/countRecognizer.ts`：0–9 专用字形识别。
- `src/recognition/heroSubcardAnalysis.ts`：装备、战宠、装备归属英雄和守护者模式。
- `src/recognition/visualEngine.ts`：真实视觉结果到统一人工确认模型的转换。
- `src/recognition/heroInference.ts`：装备归属优先的英雄推理。
- `src/recognition/review.ts`：候选结果到 `ArmyComposition` 的转换与校正。
- `src/recognition/mockEngine.ts`：样本到达前的模拟引擎。
- `src/pages/ScreenshotRecognitionPage.tsx`：上传、预检、校正和导出页面。
- `scripts/audit-recognition-samples.mjs`：样本与标签审计及标准答案生成。

## 样本接入

样本规范见 `recognition-samples/README.md`。接入命令：

```powershell
npm run samples:audit -- recognition-samples/batch-01-dev
```

生成的 `reports/audit.json` 中，每个有效样本都包含从链接解析得到的标准 `composition`，可直接作为视觉算法的 ground truth。

## 后续替换点

真实 Canvas 引擎已经接入统一结果模型，页面、人工确认、现有计算器、容量校验和链接回环无需重写。若第二批盲测显示微信压缩或未覆盖图标导致准确率不足，可只替换 `templateMatcher.ts` 为浏览器端 ONNX 小模型，其他管线保持不变。
