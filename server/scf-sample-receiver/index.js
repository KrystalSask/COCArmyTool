// COCArmyTool 识别样本收集端点。
// 部署形态：腾讯云函数 Web 函数（Express 模板），默认监听 PORT。
// 需要的环境变量：
//   COS_BUCKET    样本存储桶名（形如 coc-army-samples-125xxxxxxx）
//   COS_REGION    桶地域（形如 ap-guangzhou）
//   UPLOAD_TOKEN  共享令牌，前端上传时放在 x-upload-token 头
// 写入 COS 的凭证优先使用函数绑定的“运行角色”（SCF 会注入
// TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN 临时凭证）；
// 也可用 COS_SECRET_ID/COS_SECRET_KEY 环境变量兜底。
const express = require('express')
const COS = require('cos-nodejs-sdk-v5')

const PORT = Number(process.env.PORT || 9000)
const BUCKET = process.env.COS_BUCKET || ''
const REGION = process.env.COS_REGION || 'ap-guangzhou'
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'
const MAX_BODY_BYTES = 6 * 1024 * 1024

const cos = new COS({
  SecretId: process.env.TENCENTCLOUD_SECRETID || process.env.COS_SECRET_ID,
  SecretKey: process.env.TENCENTCLOUD_SECRETKEY || process.env.COS_SECRET_KEY,
  XCosSecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
})

const app = express()
app.use(express.json({ limit: MAX_BODY_BYTES }))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-upload-token')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// 健康检查：浏览器打开根路径即可确认端点与配置是否就绪。
app.get(['/', '/health'], (req, res) => {
  res.json({
    ok: true,
    bucketConfigured: Boolean(BUCKET),
    tokenConfigured: Boolean(UPLOAD_TOKEN),
    credentialSource: process.env.TENCENTCLOUD_SECRETID ? 'role' : process.env.COS_SECRET_ID ? 'env' : 'none',
  })
})

// 样本上传。body 为 JSON：
//   { sha256, imageBase64, imageType, sample }
// sha256 是前端 preflight 已算出的图片摘要，兼作对象键去重。
app.post('/sample', async (req, res) => {
  if (!BUCKET) return res.status(500).json({ ok: false, error: 'COS_BUCKET 未配置' })
  if (!UPLOAD_TOKEN) return res.status(500).json({ ok: false, error: 'UPLOAD_TOKEN 未配置' })
  if (req.get('x-upload-token') !== UPLOAD_TOKEN) return res.status(403).json({ ok: false, error: '令牌无效' })

  const { sha256, imageBase64, imageType, sample } = req.body || {}
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    return res.status(400).json({ ok: false, error: 'sha256 缺失或格式不对' })
  }
  if (typeof imageBase64 !== 'string' || imageBase64.length < 32) {
    return res.status(400).json({ ok: false, error: 'imageBase64 缺失' })
  }
  if (!sample || typeof sample !== 'object') {
    return res.status(400).json({ ok: false, error: 'sample 缺失' })
  }

  const ext = imageType === 'image/jpeg' ? 'jpg' : imageType === 'image/webp' ? 'webp' : 'png'
  const imageKey = `raw/${sha256}.${ext}`
  const metaKey = `meta/${sha256}.json`
  const meta = {
    ...sample,
    receivedAt: new Date().toISOString(),
    imageKey,
    sha256,
  }

  try {
    const buffer = Buffer.from(imageBase64, 'base64')
    await putObject(imageKey, buffer, imageType || 'image/png')
    await putObject(metaKey, Buffer.from(JSON.stringify(meta, null, 2)), 'application/json')
    res.json({ ok: true, imageKey, metaKey })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

const putObject = (key, body, contentType) => new Promise((resolve, reject) => {
  cos.putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: body, ContentType: contentType }, (error, data) => {
    if (error) reject(error)
    else resolve(data)
  })
})

app.listen(PORT, () => {
  // SCF 平台会探测端口，这里只输出到日志便于排查。
  console.log(`sample receiver listening on ${PORT}`)
})
