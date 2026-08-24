import { readFileSync } from 'node:fs'

const game = JSON.parse(readFileSync(new URL('../src/data/gameData.generated.json', import.meta.url), 'utf8'))
const troopById = new Map(game.troops.map((item) => [item.id, item]))
const siegeById = new Map(game.siegeMachines.map((item) => [item.id, item]))
const spellById = new Map(game.spells.map((item) => [item.id, item]))
const heroById = new Map(game.heroes.map((item) => [item.id, item]))
const petById = new Map(game.pets.map((item) => [item.id, item]))
const equipmentById = new Map(game.equipment.map((item) => [item.id, item]))

const DISPLAY_LIMITS = {
  mainTroopKinds: 11,
  mainSpellKinds: 7,
  clanCastleTotalKinds: 7,
}

const entry = (id, count = 1) => ({ id, count })
const hero = (heroId, petId, equipmentIds, mode) => ({ heroId, petId, equipmentIds, ...(mode === undefined ? {} : { mode }) })

const plans = [
  {
    key: 'A',
    focus: '皮卡、瓦基丽、戈仑、女巫、超级野蛮人、超级弓箭手；三种缺失攻城机器；7 类法术临界行；三只缺失战宠与八件缺失装备',
    heroes: [hero(0, 0, [0, 1]), hero(1, 1, [2, 15]), hero(2, 2, [4, 41], 0), hero(4, 3, [7, 9])],
    clanCastleTroops: [entry(9), entry(13), entry(51), entry(52)],
    clanCastleSpells: [entry(123, 4)],
    troops: [entry(9), entry(12), entry(13), entry(15), entry(26), entry(27), entry(8, 10), entry(110, 3), entry(51), entry(52), entry(92)],
    spells: [entry(0), entry(5), entry(10), entry(35), entry(53), entry(123, 2), entry(16)],
  },
  {
    key: 'B',
    focus: '巨石投手、超级巨人、隐秘哥布林；x17 数量；愤怒法术位于长法术行末尾；五件缺失装备',
    heroes: [hero(0, 4, [11, 10]), hero(1, 7, [20, 3]), hero(6, 8, [42, 47]), hero(7, 9, [60, 52])],
    clanCastleTroops: [entry(29, 5), entry(3), entry(92), entry(51)],
    clanCastleSpells: [entry(53), entry(123, 2)],
    troops: [entry(22), entry(29), entry(55), entry(8, 5), entry(132, 7), entry(0, 17), entry(109, 4), entry(62), entry(75), entry(87)],
    spells: [entry(1), entry(2), entry(5), entry(11), entry(17), entry(120), entry(123, 3)],
  },
  {
    key: 'C',
    focus: '超级矿工、超级女巫；x7 与窄卡片；大守护者空中模式；三件缺失皇家冠军装备',
    heroes: [hero(4, 10, [12, 40]), hero(0, 11, [8, 32]), hero(2, 16, [5, 22], 1), hero(7, 17, [56, 57])],
    clanCastleTroops: [entry(66), entry(3, 3), entry(92), entry(52)],
    clanCastleSpells: [entry(123, 2), entry(53)],
    troops: [entry(56), entry(66), entry(110, 7), entry(150, 5), entry(123, 2), entry(4, 13), entry(91), entry(135), entry(188)],
    spells: [entry(123, 7), entry(2, 2)],
  },
  {
    key: 'D',
    focus: '超级法师、超级野猪骑士；高人口压缩组合；冷冽冰晶及多件单样本装备；愤怒法术位于中间',
    heroes: [hero(4, 0, [50, 6]), hero(1, 1, [16, 3]), hero(6, 2, [35, 44]), hero(2, 7, [19, 24], 0)],
    clanCastleTroops: [entry(56), entry(22), entry(9), entry(51), entry(92)],
    clanCastleSpells: [entry(123, 2), entry(70)],
    troops: [entry(83), entry(98), entry(109, 8), entry(132, 5), entry(7, 3), entry(51), entry(52), entry(92)],
    spells: [entry(53), entry(123), entry(70), entry(98), entry(16), entry(5)],
  },
]

const capacity = (entries, lookup, excludeSiege = false) => entries.reduce((sum, item) => {
  if (excludeSiege && siegeById.has(item.id)) return sum
  return sum + item.count * (lookup.get(item.id)?.housingSpace ?? 0)
}, 0)

const encodeEntries = (entries) => entries.map(({ id, count }) => `${count}x${id}`).join('-')
const encodeHeroes = (heroes) => heroes.map((item) => {
  const mode = item.mode === undefined || item.mode === 0 ? '' : `m${item.mode}`
  return `${item.heroId}${mode}p${item.petId}e${item.equipmentIds.join('_')}`
}).join('-')
const linkFor = (plan) => {
  const payload = `h${encodeHeroes(plan.heroes)}i${encodeEntries(plan.clanCastleTroops)}d${encodeEntries(plan.clanCastleSpells)}u${encodeEntries(plan.troops)}s${encodeEntries(plan.spells)}`
  return `https://link.clashofclans.com/cn?action=CopyArmy&army=${payload}`
}

const validate = (plan) => {
  const checks = {
    army: capacity(plan.troops, troopById, true),
    spells: capacity(plan.spells, spellById),
    siege: plan.troops.filter((item) => siegeById.has(item.id)).reduce((sum, item) => sum + item.count, 0),
    castleArmy: capacity(plan.clanCastleTroops, troopById, true),
    castleSpells: capacity(plan.clanCastleSpells, spellById),
    castleSiege: plan.clanCastleTroops.filter((item) => siegeById.has(item.id)).reduce((sum, item) => sum + item.count, 0),
  }
  const expected = { army: 352, spells: 11, siege: 3, castleArmy: 55, castleSpells: 4, castleSiege: 2 }
  for (const [key, value] of Object.entries(expected)) if (checks[key] !== value) throw new Error(`${plan.key} ${key}: ${checks[key]} != ${value}`)
  const displayKinds = {
    mainTroopKinds: plan.troops.filter((item) => !siegeById.has(item.id)).length,
    mainSpellKinds: plan.spells.length,
    clanCastleTotalKinds: plan.clanCastleTroops.length + plan.clanCastleSpells.length,
  }
  for (const [key, limit] of Object.entries(DISPLAY_LIMITS)) {
    if (displayKinds[key] > limit) throw new Error(`${plan.key} ${key}: ${displayKinds[key]} > ${limit}，会发生卡片遮挡`)
  }
  if (plan.heroes.length !== 4 || new Set(plan.heroes.map((item) => item.heroId)).size !== 4) throw new Error(`${plan.key} 英雄数量或唯一性错误`)
  if (new Set(plan.heroes.map((item) => item.petId)).size !== 4) throw new Error(`${plan.key} 战宠重复`)
  for (const loadout of plan.heroes) {
    const heroItem = heroById.get(loadout.heroId)
    if (!heroItem || !petById.has(loadout.petId)) throw new Error(`${plan.key} 英雄或战宠未知`)
    if (loadout.equipmentIds.length !== 2 || loadout.equipmentIds.some((id) => equipmentById.get(id)?.hero !== heroItem.name)) throw new Error(`${plan.key} ${heroItem.name} 装备归属错误`)
    if (loadout.heroId === 2 && loadout.mode === undefined) throw new Error(`${plan.key} 大守护者缺少模式`)
  }
  return { ...checks, ...displayKinds }
}

const devices = ['iphone-17', 'ipad-pro-2024-11']
process.stdout.write('id\tlink\tlayout\tvariant\tdevice\tplan\tfocus\n')
let id = 1
for (const plan of plans) {
  validate(plan)
  const link = linkFor(plan)
  for (const device of devices) {
    process.stdout.write(`${String(id).padStart(3, '0')}\t${link}\tattack\toriginal\t${device}\t${plan.key}\t${plan.focus}\n`)
    id += 1
  }
}
