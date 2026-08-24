import type { ArmyComposition, CountEntry, HeroLoadout } from './types'

const SECTION_PATTERN = /([hidus])([^hidus]+)/g
const HERO_PATTERN = /^(\d+)(?:m(\d+))?(?:p(\d+))?(?:e(\d+)(?:_(\d+))?)?$/

const parseEntries = (value: string): CountEntry[] => value
  .split('-')
  .filter(Boolean)
  .map((entry) => {
    const match = entry.match(/^(\d+)x(\d+)$/)
    if (!match) throw new Error(`无法识别的数量条目：${entry}`)
    const count = Number(match[1])
    const id = Number(match[2])
    if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(id) || id < 0) {
      throw new Error(`无效的数量条目：${entry}`)
    }
    return { id, count }
  })

const parseHeroes = (value: string): HeroLoadout[] => value.split('-').filter(Boolean).map((entry) => {
  const match = entry.match(HERO_PATTERN)
  if (!match) throw new Error(`无法识别的英雄条目：${entry}`)
  const heroId = Number(match[1])
  const explicitMode = match[2] === undefined ? undefined : Number(match[2])
  const equipmentIds = [match[4], match[5]].filter(Boolean).map(Number)
  return {
    heroId,
    ...(heroId === 2 ? { mode: explicitMode ?? 0 } : explicitMode === undefined ? {} : { mode: explicitMode }),
    ...(match[3] === undefined ? {} : { petId: Number(match[3]) }),
    equipmentIds,
  }
})

const extractPayload = (input: string): string => {
  const normalized = input.trim().replaceAll('&amp;', '&')
  if (!normalized) throw new Error('请粘贴配兵链接')
  if (!/^https?:\/\//i.test(normalized)) return normalized
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('链接格式无效')
  }
  const payload = url.searchParams.get('army')
  if (!payload) throw new Error('链接中缺少 army 参数')
  return payload
}

export const parseArmyLink = (input: string): ArmyComposition => {
  const payload = extractPayload(input)
  const result: ArmyComposition = {
    heroes: [], clanCastleTroops: [], clanCastleSpells: [], troops: [], spells: [],
  }
  const seen = new Set<string>()
  let matchedLength = 0
  for (const match of payload.matchAll(SECTION_PATTERN)) {
    const [whole, section, value] = match
    matchedLength += whole.length
    if (seen.has(section)) throw new Error(`链接中存在重复的 ${section} 区段`)
    seen.add(section)
    if (section === 'h') result.heroes = parseHeroes(value)
    if (section === 'i') result.clanCastleTroops = parseEntries(value)
    if (section === 'd') result.clanCastleSpells = parseEntries(value)
    if (section === 'u') result.troops = parseEntries(value)
    if (section === 's') result.spells = parseEntries(value)
  }
  if (matchedLength !== payload.length || seen.size === 0) throw new Error('无法识别配兵链接内容')
  return result
}

const encodeEntries = (entries: CountEntry[]) => entries
  .filter((entry) => entry.count > 0)
  .map((entry) => `${entry.count}x${entry.id}`)
  .join('-')

const encodeHeroes = (heroes: HeroLoadout[]) => heroes.map((hero) => {
  // 国服链接省略大守护者的默认地面模式，仅为空中模式写入 m1。
  const mode = hero.mode === undefined || hero.mode === 0 ? '' : `m${hero.mode}`
  const pet = hero.petId === undefined ? '' : `p${hero.petId}`
  const equipment = hero.equipmentIds.length ? `e${hero.equipmentIds.join('_')}` : ''
  return `${hero.heroId}${mode}${pet}${equipment}`
}).join('-')

export const encodeArmyPayload = (composition: ArmyComposition): string => {
  const sections: string[] = []
  const heroValue = encodeHeroes(composition.heroes)
  const castleTroops = encodeEntries(composition.clanCastleTroops)
  const castleSpells = encodeEntries(composition.clanCastleSpells)
  const troops = encodeEntries(composition.troops)
  const spells = encodeEntries(composition.spells)
  if (heroValue) sections.push(`h${heroValue}`)
  if (castleTroops) sections.push(`i${castleTroops}`)
  if (castleSpells) sections.push(`d${castleSpells}`)
  if (troops) sections.push(`u${troops}`)
  if (spells) sections.push(`s${spells}`)
  return sections.join('')
}

export const createArmyLink = (composition: ArmyComposition, locale = 'cn'): string =>
  `https://link.clashofclans.com/${locale}?action=CopyArmy&army=${encodeArmyPayload(composition)}`

const sortEntries = (entries: CountEntry[]) => [...entries]
  .filter((entry) => entry.count > 0)
  .sort((a, b) => a.id - b.id)

export const normalizeComposition = (composition: ArmyComposition): ArmyComposition => ({
  heroes: [...composition.heroes]
    .map((hero) => ({
      heroId: hero.heroId,
      ...(hero.mode === undefined ? {} : { mode: hero.mode }),
      ...(hero.petId === undefined ? {} : { petId: hero.petId }),
      equipmentIds: [...hero.equipmentIds].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.heroId - b.heroId),
  clanCastleTroops: sortEntries(composition.clanCastleTroops),
  clanCastleSpells: sortEntries(composition.clanCastleSpells),
  troops: sortEntries(composition.troops),
  spells: sortEntries(composition.spells),
})
