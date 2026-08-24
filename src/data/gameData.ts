import generated from './gameData.generated.json'
import type { GameItem, ItemKind } from '../domain/types'
import { zhCNNames } from './localization.zh-CN'

interface GeneratedItem {
  id: number
  name: string
  kind: string
  housingSpace: number
  townHall: number | null
  hero: string | null
  rarity: string | null
}

const decorate = (item: GeneratedItem): GameItem => ({
  ...item,
  kind: item.kind as ItemKind,
  displayName: zhCNNames[item.name] ?? item.name,
  imagePath: `/game-icons/${item.kind}/${item.id}.png`,
})

export const troops = generated.troops.map(decorate)
export const siegeMachines = generated.siegeMachines.map(decorate)
export const spells = generated.spells.map(decorate)
export const heroes = generated.heroes.map(decorate)
export const pets = generated.pets.map(decorate)
export const equipment = generated.equipment.map(decorate)
export const allItems = [...troops, ...siegeMachines, ...spells, ...heroes, ...pets, ...equipment]

const byKind = (items: GameItem[]) => new Map(items.map((item) => [item.id, item]))

export const gameData = {
  troops,
  siegeMachines,
  spells,
  heroes,
  pets,
  equipment,
  troopById: byKind(troops),
  siegeById: byKind(siegeMachines),
  spellById: byKind(spells),
  heroById: byKind(heroes),
  petById: byKind(pets),
  equipmentById: byKind(equipment),
  source: generated.source,
}

export const itemByIdAndKind = (id: number, kind: ItemKind): GameItem | undefined => {
  const lookup = {
    troop: gameData.troopById,
    siege: gameData.siegeById,
    spell: gameData.spellById,
    hero: gameData.heroById,
    pet: gameData.petById,
    equipment: gameData.equipmentById,
  }[kind]
  return lookup.get(id)
}

export const isSiegeMachine = (id: number) => gameData.siegeById.has(id)
