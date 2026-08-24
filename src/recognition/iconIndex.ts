import { allItems, gameData } from '../data/gameData'
import type { GameItem, ItemKind } from '../domain/types'
import type { RecognitionRegionKind } from './types'

const regionKinds: Record<RecognitionRegionKind, ItemKind[]> = {
  heroes: ['hero', 'pet', 'equipment'],
  mainTroops: ['troop'],
  mainSpells: ['spell'],
  mainSiege: ['siege'],
  castleArmy: ['troop', 'siege', 'spell'],
}

export const iconCandidatesByKind = new Map<ItemKind, GameItem[]>([
  ['troop', gameData.troops],
  ['siege', gameData.siegeMachines],
  ['spell', gameData.spells],
  ['hero', gameData.heroes],
  ['pet', gameData.pets],
  ['equipment', gameData.equipment],
])

export const getIconCandidates = (region: RecognitionRegionKind) => regionKinds[region]
  .flatMap((kind) => iconCandidatesByKind.get(kind) ?? [])

export const equipmentOwnerById = new Map(gameData.equipment.map((equipment) => {
  const hero = gameData.heroes.find((candidate) => candidate.name === equipment.hero)
  return [equipment.id, hero?.id] as const
}))

export interface IconFeatureRecord {
  key: string
  item: GameItem
  hash?: bigint
}

export const iconFeatureManifest: IconFeatureRecord[] = allItems.map((item) => ({
  key: `${item.kind}:${item.id}`,
  item,
}))

export const computeDifferenceHash = (luminance: readonly number[]): bigint => {
  if (luminance.length !== 72) throw new Error('dHash 需要 9×8 个灰度采样值')
  let hash = 0n
  let bit = 0n
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (luminance[y * 9 + x] > luminance[y * 9 + x + 1]) hash |= 1n << bit
      bit += 1n
    }
  }
  return hash
}

export const hammingDistance = (left: bigint, right: bigint) => {
  let value = left ^ right
  let count = 0
  while (value) {
    count += Number(value & 1n)
    value >>= 1n
  }
  return count
}

export class IconFeatureCache {
  private readonly hashes = new Map<string, bigint>()

  set(kind: ItemKind, id: number, hash: bigint) {
    this.hashes.set(`${kind}:${id}`, hash)
  }

  get(kind: ItemKind, id: number) {
    return this.hashes.get(`${kind}:${id}`)
  }

  rank(kind: ItemKind, queryHash: bigint, limit = 3) {
    return (iconCandidatesByKind.get(kind) ?? [])
      .flatMap((item) => {
        const hash = this.get(kind, item.id)
        return hash === undefined ? [] : [{ item, distance: hammingDistance(queryHash, hash) }]
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
  }
}
