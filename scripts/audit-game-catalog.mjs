import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveTownHall } from './catalog-overrides.mjs'

const sourcePath = process.env.COC_STATIC_DATA_PATH
if (!sourcePath) throw new Error('请设置 COC_STATIC_DATA_PATH 指向当前 clashy.py static_data.json')

const source = JSON.parse(readFileSync(resolve(sourcePath), 'utf8'))
const generated = JSON.parse(readFileSync(resolve('src/data/gameData.generated.json'), 'utf8'))
const suffixId = (id) => id % 1_000_000
const permanentTrainable = source.troops.filter((item) => item.village === 'home' && item.housing_space > 0 && !item.is_seasonal && item.production_building_level > 0)
const permanentSpells = source.spells.filter((item) => item.housing_space > 0 && !item.is_seasonal && item.production_building_level > 0)

const expected = {
  troops: permanentTrainable.filter((item) => item.production_building !== 'Workshop'),
  siegeMachines: permanentTrainable.filter((item) => item.production_building === 'Workshop'),
  spells: permanentSpells,
  heroes: source.heroes.filter((item) => item.village === 'home'),
  pets: source.pets,
  equipment: source.equipment,
}

const issues = []
for (const [kind, sourceItems] of Object.entries(expected)) {
  const actualItems = generated[kind]
  const actualById = new Map(actualItems.map((item) => [item.id, item]))
  const expectedIds = new Set(sourceItems.map((item) => suffixId(item._id)))
  for (const sourceItem of sourceItems) {
    const id = suffixId(sourceItem._id)
    const actual = actualById.get(id)
    if (!actual) issues.push(`${kind} 缺少 ${id}:${sourceItem.name}`)
    else {
      if (actual.name !== sourceItem.name) issues.push(`${kind}:${id} 名称 ${actual.name} != ${sourceItem.name}`)
      if (actual.housingSpace !== (sourceItem.housing_space ?? 0)) issues.push(`${kind}:${id} 空间 ${actual.housingSpace} != ${sourceItem.housing_space ?? 0}`)
      const expectedTownHall = resolveTownHall(sourceItem, actual.kind, suffixId)
      if (actual.townHall !== expectedTownHall) issues.push(`${kind}:${id} 大本营等级 ${actual.townHall} != ${expectedTownHall}`)
    }
  }
  for (const actual of actualItems) if (!expectedIds.has(actual.id)) issues.push(`${kind} 多余 ${actual.id}:${actual.name}`)
}

const expectedAssets = new Set()
for (const [kind, items] of Object.entries(generated).filter(([, value]) => Array.isArray(value))) {
  for (const item of items) {
    const asset = resolve('public', 'game-icons', item.kind, `${item.id}.png`)
    expectedAssets.add(asset)
    if (!existsSync(asset)) issues.push(`${kind}:${item.id} 缺少图标 ${asset}`)
  }
}
for (const directory of ['troop', 'siege', 'spell', 'hero', 'pet', 'equipment']) {
  const assetDirectory = resolve('public', 'game-icons', directory)
  for (const file of readdirSync(assetDirectory).filter((name) => name.endsWith('.png'))) {
    const asset = resolve(assetDirectory, file)
    if (!expectedAssets.has(asset)) issues.push(`${directory} 多余图标 ${asset}`)
  }
}

const counts = Object.fromEntries(Object.entries(expected).map(([kind, items]) => [kind, items.length]))
process.stdout.write(`常驻图鉴对照：${JSON.stringify(counts)}\n`)
if (issues.length) {
  process.stderr.write(`${issues.join('\n')}\n`)
  process.exitCode = 1
} else process.stdout.write('源元数据、生成数据和图标三方一致\n')
