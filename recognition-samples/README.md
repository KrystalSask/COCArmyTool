# 截图识别数据集

本目录保存用于开发、覆盖评估、盲测和特殊问题复现的原始截图。数据集会进入公开 Git 仓库，但不会进入 `public/`、Web 生产构建、PWA 缓存或 Tauri 安装包。

## 分类

| 目录 | 类型 | 是否参与模板/阈值 | 是否提交原图 |
| --- | --- | --- | --- |
| `batch-01-dev` | 第一批开发与回归集 | 是 | 是 |
| `batch-02-request` | 覆盖驱动补样集 | 是 | 是 |
| `batch-02-blind` | 算法冻结后的独立盲测集 | 否 | 是 |
| `seed-unlabelled` | 无标签布局种子 | 仅布局调试 | 是 |
| `manual-tests` | 特殊布局与故障复现 | 否 | 是 |

标准批次采用 `images/`（原始图片）、`labels.txt`（Tab 分隔标签）、可选 `metadata.json`、可再生成的 `derived/` 和 `reports/`。

## 标签格式

```text
id	link	layout	variant	device
001	https://link.clashofclans.com/cn?action=CopyArmy&army=...	edit	original	phone-a
```

- `layout`：`saved`、`edit` 或项目明确支持的其他布局。
- `variant`：`original`、`wechat` 等采集/压缩来源。
- `device`：稳定设备代号；不要记录设备序列号或用户身份。
- 保留原图真实扩展名；不得裁剪、缩放、涂画或二次截图。

## 隐私和公开检查

提交新原图前必须确认：

- 图片提供者知道样本会进入公开仓库。
- 截图不包含聊天、通知、二维码或其他不应公开的信息。
- 玩家名称、部落信息等画面元素已获得公开许可，或已在不影响识别区域的前提下合规处理。
- 文件与现有原图没有重复哈希。
- 标签只包含复现所必需的信息。

## 审计与派生

```powershell
npm run samples:audit -- recognition-samples/batch-01-dev
npm run samples:preprocess -- recognition-samples/batch-01-dev
npm run samples:variants -- recognition-samples/batch-01-dev
```

工具会在批次的 `reports/` 或 `derived/` 下生成输出，这些目录不提交 Git。如需保留基准结论，应把摘要整理到 `docs/`。

## 旧数据整理说明

原 `dataset/` 的 13 张图片与 `batch-01-dev/images` 哈希完全一致，原 `batch-02-request` 根目录图片也与其 `images/` 子目录完全一致。整理时已保留规范目录中的原图、标签和元数据，并删除重复副本，避免 Git 历史无意义膨胀。

完整维护流程见 `docs/MAINTENANCE.md`。
