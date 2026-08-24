# 手工回归截图

这里保存不属于标准训练/评估批次、但用于复现特殊布局问题的原始截图。

| 文件 | 用途 |
| --- | --- |
| `images/army-saved-ipad.png` | iPad 已保存配置布局的人工检查样本 |
| `images/video-subtitle-ipad.png` | 带上下黑边与视频字幕的面板定位端到端回归样本 |

第二张图片由 `e2e/video-screenshot.spec.ts` 直接引用。文件名不得随意修改；若替换样本，必须同步更新测试预期并记录原因。
