# 样本收集端点（腾讯云函数 + COS）

部署步骤与配置说明见 `docs/mobile-web-adaptation-assessment-20260827.md` 的“样本收集”一节。

## 文件

- `index.js`：函数代码（Web 函数，Express）。整份粘贴到控制台在线编辑器的 `index.js`。
- `package.json`：依赖清单。整份替换控制台的 `package.json` 后点“依赖安装”。

## 环境变量（函数配置 → 环境变量）

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `COS_BUCKET` | 如 `coc-army-samples-125xxxxxxx` | 样本桶名（含 APPID 后缀） |
| `COS_REGION` | 如 `ap-guangzhou` | 桶地域 |
| `UPLOAD_TOKEN` | 随机 32 位十六进制串 | 与前端共享的上传令牌 |

写入 COS 的凭证来自函数绑定的“运行角色”（需要 COS 写入权限），不需要在环境变量里放长期密钥。

## 接口

- `GET /health`：健康检查，返回配置就绪状态。
- `POST /sample`：上传样本。头 `x-upload-token`；body 为 JSON `{ sha256, imageBase64, imageType, sample }`。

## 存储布局

- `raw/<sha256>.<ext>`：原始截图。
- `meta/<sha256>.json`：机器候选、人工确认结果与元数据。
