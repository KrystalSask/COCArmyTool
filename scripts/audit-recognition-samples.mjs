import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

const batchPath = resolve(process.argv[2] ?? 'recognition-samples/batch-01-dev')
const imagesPath = join(batchPath, 'images')
const labelsPath = join(batchPath, 'labels.txt')
const actualEquipmentPath = join(batchPath, 'actual-equipment.json')
const reportsPath = join(batchPath, 'reports')
const game = JSON.parse(readFileSync(new URL('../src/data/gameData.generated.json', import.meta.url), 'utf8'))
const actualEquipment = existsSync(actualEquipmentPath)
  ? JSON.parse(readFileSync(actualEquipmentPath, 'utf8')).samples ?? {}
  : {}

if (!existsSync(imagesPath) || !existsSync(labelsPath)) {
  process.stderr.write(`样本目录无效：需要 ${imagesPath} 和 ${labelsPath}\n`)
  process.exit(1)
}

const normalizeId = (value) => /^\d+$/.test(value) ? String(Number(value)).padStart(3, '0') : value
const parseEntries = (value) => value ? value.split('-').filter(Boolean).map((entry) => {
  const match = entry.match(/^(\d+)x(\d+)$/)
  if (!match) throw new Error(`无法识别数量条目 ${entry}`)
  return { count: Number(match[1]), id: Number(match[2]) }
}) : []

const parseHeroes = (value) => value ? value.split('-').filter(Boolean).map((entry) => {
  const match = entry.match(/^(\d+)(?:m(\d+))?(?:p(\d+))?(?:e(\d+)(?:_(\d+))?)?$/)
  if (!match) throw new Error(`无法识别英雄条目 ${entry}`)
  const heroId = Number(match[1])
  const explicitMode = match[2] === undefined ? undefined : Number(match[2])
  return {
    heroId,
    ...(heroId === 2 ? { mode: explicitMode ?? 0 } : explicitMode === undefined ? {} : { mode: explicitMode }),
    ...(match[3] === undefined ? {} : { petId: Number(match[3]) }),
    equipmentIds: [match[4], match[5]].filter(Boolean).map(Number),
  }
}) : []

const parseLink = (link) => {
  const url = new URL(link)
  if (url.hostname !== 'link.clashofclans.com' || !url.pathname.startsWith('/cn')) throw new Error('必须是国服 link.clashofclans.com/cn 链接')
  const payload = url.searchParams.get('army')
  if (!payload) throw new Error('链接缺少 army 参数')
  const sections = {}
  let length = 0
  for (const match of payload.matchAll(/([hidus])([^hidus]+)/g)) {
    if (sections[match[1]]) throw new Error(`重复区段 ${match[1]}`)
    sections[match[1]] = match[2]
    length += match[0].length
  }
  if (length !== payload.length) throw new Error('army 参数包含无法识别的内容')
  return {
    heroes: parseHeroes(sections.h),
    clanCastleTroops: parseEntries(sections.i),
    clanCastleSpells: parseEntries(sections.d),
    troops: parseEntries(sections.u),
    spells: parseEntries(sections.s),
  }
}

const lookups = {
  troops: new Map(game.troops.map((item) => [item.id, item])),
  siege: new Map(game.siegeMachines.map((item) => [item.id, item])),
  spells: new Map(game.spells.map((item) => [item.id, item])),
  heroes: new Map(game.heroes.map((item) => [item.id, item])),
  pets: new Map(game.pets.map((item) => [item.id, item])),
  equipment: new Map(game.equipment.map((item) => [item.id, item])),
}

const sum = (entries, lookup) => entries.reduce((total, entry) => total + entry.count * (lookup.get(entry.id)?.housingSpace ?? 0), 0)
const unknownEntries = (entries, ...maps) => entries.filter((entry) => !maps.some((map) => map.has(entry.id))).map((entry) => entry.id)

const inspectComposition = (composition) => {
  const catalogIssues = []
  const unknown = {
    troops: unknownEntries(composition.troops, lookups.troops, lookups.siege),
    clanCastleTroops: unknownEntries(composition.clanCastleTroops, lookups.troops, lookups.siege),
    spells: unknownEntries(composition.spells, lookups.spells),
    clanCastleSpells: unknownEntries(composition.clanCastleSpells, lookups.spells),
    heroes: composition.heroes.filter((hero) => !lookups.heroes.has(hero.heroId)).map((hero) => hero.heroId),
    pets: composition.heroes.map((hero) => hero.petId).filter((id) => id !== undefined && !lookups.pets.has(id)),
    equipment: composition.heroes.flatMap((hero) => hero.equipmentIds).filter((id) => !lookups.equipment.has(id)),
  }
  for (const [kind, ids] of Object.entries(unknown)) if (ids.length) catalogIssues.push(`${kind} 未收录 ID：${[...new Set(ids)].join(', ')}`)

  const mainTroops = composition.troops.filter((entry) => !lookups.siege.has(entry.id))
  const castleTroops = composition.clanCastleTroops.filter((entry) => !lookups.siege.has(entry.id))
  const capacities = {
    army: sum(mainTroops, lookups.troops),
    spells: sum(composition.spells, lookups.spells),
    siegeMachines: composition.troops.filter((entry) => lookups.siege.has(entry.id)).reduce((total, entry) => total + entry.count, 0),
    clanCastleTroops: sum(castleTroops, lookups.troops),
    clanCastleSpells: sum(composition.clanCastleSpells, lookups.spells),
    clanCastleSiegeMachines: composition.clanCastleTroops.filter((entry) => lookups.siege.has(entry.id)).reduce((total, entry) => total + entry.count, 0),
  }

  const exportIssues = []
  if (!catalogIssues.length) {
    const limits = { army: 352, spells: 11, siegeMachines: 3, clanCastleTroops: 55, clanCastleSpells: 4, clanCastleSiegeMachines: 2 }
    for (const [key, expected] of Object.entries(limits)) if (capacities[key] !== expected) exportIssues.push(`${key}=${capacities[key]}，应为 ${expected}`)
  }
  if (composition.heroes.length !== 4) exportIssues.push('出战英雄应为 4 位')
  if (new Set(composition.heroes.map((hero) => hero.heroId)).size !== composition.heroes.length) exportIssues.push('英雄重复')
  const petIds = composition.heroes.map((hero) => hero.petId).filter((id) => id !== undefined)
  if (petIds.length !== 4 || new Set(petIds).size !== petIds.length) exportIssues.push('战宠缺失或重复')
  for (const hero of composition.heroes) {
    const heroItem = lookups.heroes.get(hero.heroId)
    if (hero.equipmentIds.length !== 2 || new Set(hero.equipmentIds).size !== 2) exportIssues.push(`英雄 ${hero.heroId} 装备数量无效`)
    for (const id of hero.equipmentIds) if (lookups.equipment.get(id)?.hero !== heroItem?.name) exportIssues.push(`装备 ${id} 不属于英雄 ${hero.heroId}`)
    if (hero.heroId === 2 && ![0, 1].includes(hero.mode)) exportIssues.push('大守护者模式无效')
  }
  return {
    catalogReady: catalogIssues.length === 0,
    catalogIssues,
    unknown,
    capacities,
    exportEligible: catalogIssues.length ? null : exportIssues.length === 0,
    exportIssues,
  }
}

const imageDimensions = (buffer, extension) => {
  if (extension === '.png' && buffer.subarray(1, 4).toString() === 'PNG') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' }
  if (['.jpg', '.jpeg'].includes(extension) && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), format: 'jpeg' }
      }
      const length = buffer.readUInt16BE(offset + 2)
      if (!length) break
      offset += 2 + length
    }
  }
  throw new Error('仅支持内容真实有效的 PNG/JPG 图片')
}

const lines = readFileSync(labelsPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
const labels = []
for (const [index, line] of lines.entries()) {
  if (index === 0 && line.toLowerCase().startsWith('id\t')) continue
  const columns = line.split('\t')
  if (columns.length >= 2) labels.push({ id: normalizeId(columns[0]), link: columns[1], layout: columns[2] ?? '', variant: columns[3] ?? '', device: columns[4] ?? '' })
  else {
    const match = line.match(/^(\d+)\.(https?:\/\/.*)$/)
    if (!match) throw new Error(`labels.txt 第 ${index + 1} 行格式无效`)
    labels.push({ id: normalizeId(match[1]), link: match[2], layout: '', variant: '', device: '' })
  }
}

const imageFiles = readdirSync(imagesPath).filter((file) => ['.png', '.jpg', '.jpeg'].includes(extname(file).toLowerCase()))
const imageById = new Map(imageFiles.map((file) => [normalizeId(basename(file, extname(file))), file]))
const labelIds = new Set(labels.map((label) => label.id))
const globalIssues = []
if (imageById.size !== imageFiles.length) globalIssues.push('存在仅前导零不同的重复图片编号')
for (const file of imageFiles) if (!labelIds.has(normalizeId(basename(file, extname(file))))) globalIssues.push(`图片 ${file} 没有标签`)
for (const label of labels) if (!imageById.has(label.id)) globalIssues.push(`标签 ${label.id} 没有对应图片`)
if (labelIds.size !== labels.length) globalIssues.push('labels.txt 存在重复 ID')

const hashes = new Map()
const samples = labels.map((label) => {
  const integrityIssues = []
  const actualEquipmentOverrides = actualEquipment[label.id] ?? {}
  const file = imageById.get(label.id)
  let image
  let sha256 = ''
  if (file) {
    try {
      const buffer = readFileSync(join(imagesPath, file))
      sha256 = createHash('sha256').update(buffer).digest('hex')
      image = { file, ...imageDimensions(buffer, extname(file).toLowerCase()), bytes: buffer.length, aspectRatio: 0 }
      image.aspectRatio = Number((image.width / image.height).toFixed(4))
      if (image.width < 1000 || image.height < 500 || image.aspectRatio < 1.3 || image.aspectRatio > 2.4) integrityIssues.push('分辨率或画面比例不符合完整横屏截图要求')
      if (hashes.has(sha256)) integrityIssues.push(`与样本 ${hashes.get(sha256)} 图片完全重复`)
      else hashes.set(sha256, label.id)
    } catch (error) { integrityIssues.push(error instanceof Error ? error.message : String(error)) }
  }
  let composition
  let compositionAudit
  try {
    composition = parseLink(label.link)
    compositionAudit = inspectComposition(composition)
  } catch (error) { integrityIssues.push(error instanceof Error ? error.message : String(error)) }
  if (label.layout && !['saved', 'edit', 'attack'].includes(label.layout)) integrityIssues.push('layout 必须是 saved、edit 或 attack')
  if (label.variant && !['original', 'wechat'].includes(label.variant)) integrityIssues.push('variant 必须是 original 或 wechat')
  if (!label.device) integrityIssues.push('device 不能为空')
  for (const [heroId, equipmentIds] of Object.entries(actualEquipmentOverrides)) {
    if (!Array.isArray(equipmentIds) || equipmentIds.length !== 2) {
      integrityIssues.push(`actual-equipment hero ${heroId} must contain two aligned slots`)
      continue
    }
    for (const equipmentId of equipmentIds) {
      if (equipmentId !== null && !lookups.equipment.has(equipmentId)) integrityIssues.push(`actual-equipment unknown equipment ID ${equipmentId}`)
    }
  }
  const integrityValid = integrityIssues.length === 0
  return {
    ...label, image, sha256, composition, compositionAudit, actualEquipmentOverrides,
    integrityValid,
    recognitionReady: integrityValid && Boolean(compositionAudit?.catalogReady),
    valid: integrityValid,
    integrityIssues,
  }
})

const countBy = (values) => Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]))
const report = {
  batch: basename(batchPath),
  auditedAt: new Date().toISOString(),
  catalogSource: game.source,
  sampleCount: samples.length,
  integrityValidCount: samples.filter((sample) => sample.integrityValid).length,
  recognitionReadyCount: samples.filter((sample) => sample.recognitionReady).length,
  catalogBlockedCount: samples.filter((sample) => sample.integrityValid && !sample.compositionAudit?.catalogReady).length,
  exportEligibleCount: samples.filter((sample) => sample.compositionAudit?.exportEligible === true).length,
  negativeExampleCount: samples.filter((sample) => sample.compositionAudit?.exportEligible === false).length,
  distributions: {
    devices: countBy(samples.map((sample) => sample.device || '未标注')),
    layouts: countBy(samples.map((sample) => sample.layout || '未标注')),
    resolutions: countBy(samples.map((sample) => sample.image ? `${sample.image.width}x${sample.image.height}` : '未知')),
  },
  globalIssues,
  samples,
}

mkdirSync(reportsPath, { recursive: true })
writeFileSync(join(reportsPath, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`)
const markdown = [
  `# ${report.batch} 样本审计`, '',
  `- 样本：${report.sampleCount}`,
  `- 文件与标签完整：${report.integrityValidCount}`,
  `- 可用于识别开发：${report.recognitionReadyCount}`,
  `- 图鉴阻塞：${report.catalogBlockedCount}`,
  `- 满足导出规则：${report.exportEligibleCount}`,
  `- 有意保留的负例：${report.negativeExampleCount}`, '',
  '## 分布', '',
  `- 设备：${JSON.stringify(report.distributions.devices)}`,
  `- 分辨率：${JSON.stringify(report.distributions.resolutions)}`,
  `- 布局：${JSON.stringify(report.distributions.layouts)}`, '',
  ...(globalIssues.length ? ['## 批次问题', '', ...globalIssues.map((issue) => `- ${issue}`), ''] : []),
  '## 样本', '',
  '| ID | 设备 | 分辨率 | 样本完整 | 图鉴 | 导出资格 | 说明 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...samples.map((sample) => {
    const details = [...sample.integrityIssues, ...(sample.compositionAudit?.catalogIssues ?? []), ...(sample.compositionAudit?.exportIssues ?? [])]
    const eligibility = sample.compositionAudit?.exportEligible === null ? '无法核算' : sample.compositionAudit?.exportEligible ? '通过' : '负例'
    return `| ${sample.id} | ${sample.device || '未标注'} | ${sample.image ? `${sample.image.width}×${sample.image.height}` : '缺失'} | ${sample.integrityValid ? '通过' : '失败'} | ${sample.compositionAudit?.catalogReady ? '完整' : '缺项'} | ${eligibility} | ${details.join('；') || '-'} |`
  }), ''
].join('\n')
writeFileSync(join(reportsPath, 'audit.md'), markdown)
process.stdout.write(`样本 ${report.sampleCount}，完整 ${report.integrityValidCount}，识别可用 ${report.recognitionReadyCount}，导出正例 ${report.exportEligibleCount}，负例 ${report.negativeExampleCount}\n报告：${reportsPath}\n`)
if (globalIssues.length || report.integrityValidCount !== report.sampleCount || report.catalogBlockedCount) process.exitCode = 1
