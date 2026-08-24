import type { ArmyComposition, CountEntry, HeroLoadout } from './types'

export const setEntryCount = (entries: CountEntry[], id: number, count: number): CountEntry[] => {
  const next = entries.filter((entry) => entry.id !== id)
  if (count > 0) next.push({ id, count: Math.max(1, Math.floor(count)) })
  return next
}

export const getEntryCount = (entries: CountEntry[], id: number) => entries.find((entry) => entry.id === id)?.count ?? 0

export const replaceHeroAt = (heroes: HeroLoadout[], index: number, hero: HeroLoadout): HeroLoadout[] => {
  const next = [...heroes]
  next[index] = hero
  return next
}

export const cloneComposition = (composition: ArmyComposition): ArmyComposition => ({
  heroes: composition.heroes.map((hero) => ({ ...hero, equipmentIds: [...hero.equipmentIds] })),
  clanCastleTroops: composition.clanCastleTroops.map((entry) => ({ ...entry })),
  clanCastleSpells: composition.clanCastleSpells.map((entry) => ({ ...entry })),
  troops: composition.troops.map((entry) => ({ ...entry })),
  spells: composition.spells.map((entry) => ({ ...entry })),
})
