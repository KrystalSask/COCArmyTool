import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

const sourcePath = resolve(process.argv[2] ?? 'dataset')
const metadataPath = join(sourcePath, 'metadata.json')
if (!existsSync(metadataPath)) throw new Error(`缺少采集配置：${metadataPath}`)

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
const targetPath = resolve(process.argv[3] ?? join('recognition-samples', metadata.batch ?? 'batch-01-dev'))
const sourceLabelsPath = ['label.txt', 'labels.txt'].map((name) => join(sourcePath, name)).find(existsSync)
if (!sourceLabelsPath) throw new Error('源目录缺少 label.txt 或 labels.txt')

const normalizeId = (value) => {
  const id = String(value).trim()
  return /^\d+$/.test(id) ? String(Number(id)).padStart(3, '0') : id
}

const parseLabels = (value) => value.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line, index) => {
  if (index === 0 && line.toLowerCase().startsWith('id\t')) return []
  const columns = line.split('\t')
  if (columns.length >= 2) return [{ id: normalizeId(columns[0]), link: columns[1] }]
  const match = line.match(/^(\d+)\.(https?:\/\/.*)$/)
  if (!match) throw new Error(`标签第 ${index + 1} 行格式无效`)
  return [{ id: normalizeId(match[1]), link: match[2] }]
})

const labels = parseLabels(readFileSync(sourceLabelsPath, 'utf8'))
const imageFiles = readdirSync(sourcePath).filter((file) => ['.png', '.jpg', '.jpeg'].includes(extname(file).toLowerCase()))
const imageById = new Map(imageFiles.map((file) => [normalizeId(basename(file, extname(file))), file]))
if (labels.length !== imageFiles.length) throw new Error(`标签 ${labels.length} 条，图片 ${imageFiles.length} 张，数量不一致`)
if (new Set(labels.map(({ id }) => id)).size !== labels.length) throw new Error('标签存在重复编号')

const profileFor = (id) => metadata.profiles.find((profile) => Number(id) >= profile.ids[0] && Number(id) <= profile.ids[1])
const rows = labels.map((label) => {
  const sourceFile = imageById.get(label.id)
  if (!sourceFile) throw new Error(`标签 ${label.id} 没有对应图片`)
  const profile = profileFor(label.id)
  if (!profile) throw new Error(`样本 ${label.id} 没有设备配置`)
  return { ...label, sourceFile, targetFile: `${label.id}${extname(sourceFile).toLowerCase()}`, profile }
})

const imagesPath = join(targetPath, 'images')
const reportsPath = join(targetPath, 'reports')
mkdirSync(imagesPath, { recursive: true })
mkdirSync(reportsPath, { recursive: true })

for (const row of rows) {
  const sourceFile = join(sourcePath, row.sourceFile)
  const targetFile = join(imagesPath, row.targetFile)
  if (existsSync(targetFile)) {
    const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
    if (digest(sourceFile) !== digest(targetFile)) throw new Error(`目标图片已存在且内容不同：${targetFile}`)
  } else copyFileSync(sourceFile, targetFile)
}

const header = 'id\tlink\tlayout\tvariant\tdevice'
const output = [header, ...rows.map((row) => [row.id, row.link, metadata.layout, metadata.variant, row.profile.device].join('\t')), ''].join('\n')
writeFileSync(join(targetPath, 'labels.txt'), output, 'utf8')

const manifest = {
  importedAt: new Date().toISOString(),
  source: sourcePath,
  target: targetPath,
  sampleCount: rows.length,
  rawFilesPreserved: true,
  profiles: metadata.profiles,
}
writeFileSync(join(reportsPath, 'import.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
process.stdout.write(`已无损导入 ${rows.length} 个样本到 ${targetPath}\n`)
