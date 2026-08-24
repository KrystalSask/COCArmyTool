import fs from 'node:fs'
import path from 'node:path'
import { resolveTownHall } from './catalog-overrides.mjs'

const source = process.env.COC_STATIC_DATA_PATH
if (!source) {
  throw new Error('请设置 COC_STATIC_DATA_PATH 指向 clashy.py 的 static_data.json')
}

const output = path.resolve('src/data/gameData.generated.json')
const raw = JSON.parse(fs.readFileSync(source, 'utf8'))

const suffixId = (id) => id % 1_000_000
const isPermanentTrainable = (item) => (
  item.village === 'home'
  && (item.housing_space ?? 0) > 0
  && !item.is_seasonal
  && (item.production_building_level ?? 0) > 0
)
const isPermanentSpell = (item) => (
  (item.housing_space ?? 0) > 0
  && !item.is_seasonal
  && (item.production_building_level ?? 0) > 0
)
const simplify = (item, kind) => ({
  id: suffixId(item._id),
  name: item.name,
  kind,
  housingSpace: item.housing_space ?? 0,
  townHall: resolveTownHall(item, kind, suffixId),
  hero: item.hero ?? null,
  rarity: item.rarity ?? null,
})

const result = {
  source: process.env.COC_STATIC_DATA_VERSION ?? 'clashy.py static game metadata (auto-filtered)',
  generatedAt: new Date().toISOString(),
  troops: raw.troops.filter((item) => isPermanentTrainable(item) && item.production_building !== 'Workshop').map((item) => simplify(item, 'troop')),
  siegeMachines: raw.troops.filter((item) => isPermanentTrainable(item) && item.production_building === 'Workshop').map((item) => simplify(item, 'siege')),
  spells: raw.spells.filter(isPermanentSpell).map((item) => simplify(item, 'spell')),
  heroes: raw.heroes.filter((item) => item.village === 'home').map((item) => simplify(item, 'hero')),
  pets: raw.pets.map((item) => simplify(item, 'pet')),
  equipment: raw.equipment.map((item) => simplify(item, 'equipment')),
}

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Generated ${output}`)
