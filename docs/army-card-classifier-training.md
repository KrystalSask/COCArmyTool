# 国服军队卡片分类模型训练流程

## 数据范围

- 49 个兵种、18 个法术、9 个攻城机器，共 76 类。
- 四个区域共用一个闭集分类模型，不包含无效类别。
- 主兵种、主法术、主攻城区域在推理时限制类别；援军区允许全部 76 类。
- 装备、战宠和英雄不在本模型范围内。

## 1. 生成合成训练集

```powershell
npm run dataset:army-cards -- --force
```

输出：`artifacts/army-card-classification-cn-v1/train`，每类 100 张，共 7,600 张。

## 2. 生成真实验证候选

```powershell
npm run dataset:army-real-val -- --force
```

打开：`artifacts/army-card-real-validation-review-v1/review.html`。

- 三个主区域按照配兵链接顺序对齐，可以分区域检查后批量确认。
- 援军区旧标签顺序不可靠，审核页面会禁止批量确认，必须逐张确认、改标或排除。
- 审核完成后点击“导出审核结果 JSON”。

## 3. 导入审核结果

```powershell
npm run dataset:army-apply-val -- "审核结果JSON的完整路径" --force
```

默认要求所有候选都已处理。只想导入已审核部分时添加 `--allow-partial`，但正式模型评估前应确认 `validation-summary.json` 没有缺失类别。

## 4. GPU 冒烟训练

```powershell
npm run train:army-cards -- --smoke --epochs 3 --batch 64
```

冒烟划分来自合成数据，只验证 CUDA、数据加载、类别数和权重输出，不代表真实准确率。

## 5. 正式两阶段训练

冻结主干训练分类头：

```powershell
npm run train:army-cards -- --epochs 15 --freeze 10 --lr0 0.001 --batch 64 --name army-card-head-v1
```

加载第一阶段最佳权重并解冻微调：

```powershell
npm run train:army-cards -- --model "artifacts/army-card-training-runs/army-card-head-v1/weights/best.pt" --epochs 40 --freeze 0 --lr0 0.0003 --batch 64 --name army-card-finetune-v1
```

训练器保持完整 160×160 画布，不使用随机裁剪、旋转、镜像或透视。

## 6. 真实验证集评估

```powershell
npm run evaluate:army-cards -- "artifacts/army-card-training-runs/army-card-finetune-v1/weights/best.pt"
```

输出 `artifacts/army-card-evaluation-v1/metrics.json` 和 `predictions.csv`，包含：

- 原始 Top-1、Top-3；
- 区域约束后的 Top-1、Top-3；
- 分区域指标；
- 每类别指标；
- 混淆记录。

模型始终输出 76 个合法类别之一，不执行无效类别或拒识判断。
