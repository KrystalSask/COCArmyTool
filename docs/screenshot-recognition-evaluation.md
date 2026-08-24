# 截图识别 MVP 评估报告

评估日期：2026-08-11。数据集：`recognition-samples/batch-01-dev`，共 13 张完整国服截图，其中 iPhone 17 为 7 张，iPad Pro 2024 11 英寸为 6 张。全部是 `edit` 布局；11 张满足导出规则，002（缺战宠）和 007（援军攻城机器 0/2）为有意保留的负例。

## 浏览器端到端结果

真实 Edge 浏览器逐张上传原始 PNG 并运行与产品相同的 Canvas 管线：

| 项目 | 结果 |
| --- | --- |
| 面板定位与设备画像 | 13/13 通过 |
| 卡片分割 | 287/287，区域数量无漏检或多检 |
| 卡片 Top-1 | 286/287（99.65%） |
| 卡片 Top-3 | 287/287（100%） |
| 完整数量值 | 287/287（100%） |
| 装备、装备归属英雄 | 13/13 样本一致 |
| 战宠（含空槽） | 13/13 样本一致 |
| 大守护者模式 | 13/13 样本一致 |
| 需人工改正卡片 | 12 张为 0 项，1 张为 1 项 |

安全导出实测：001 在确认全部真实候选后可导出；002 即使确认所有已识别项，仍因缺战宠不可导出；007 即使确认所有候选，仍因援军攻城机器容量不足不可导出。三者均通过同一产品校验和链接回环代码路径。

机器生成的原始报告位于 `recognition-samples/batch-01-dev/reports/browser-mvp-evaluation.json`，由 Playwright 回归测试产生；该目录包含用户样本派生结果，因此按项目规则不进入生产构建。

## 留一截图评估

为避免把同一张测试卡片直接与自身模板比较，模板生成器还执行 leave-one-sample-out：

- 军队卡片：Top-1 96.70%，Top-3 99.27%；14 个仅出现于单张截图的观测不计入该指标。
- 数字字形：可跨截图评估的 286/286 正确；数字 0 和 7 各只有一个观测，暂不计入跨截图指标。
- 装备：98/98 Top-1 正确；6 个单次观测不计入。
- 战宠：51/51 Top-1 正确。
- 大守护者地面/空中模式：13/13 Top-1 正确。

该结果是开发集基线，不等同于第二批冻结盲测。下一批覆盖样本和独立盲测建议见 `docs/screenshot-recognition-next-samples.md`。

## 可复现命令

```powershell
$env:COC_STATIC_DATA_PATH='C:\path\to\clashy.py\coc\static\static_data.json'
npm run catalog:audit
npm run samples:audit
npm run samples:preprocess
npm run samples:extract-templates
npm test
npm run build
npm run test:e2e
```

验收以测试失败为失败，不以页面能显示结果代替准确率、安全门槛或链接回环验证。
