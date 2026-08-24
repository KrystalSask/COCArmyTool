import { gameData } from '../data/gameData'
import type { HeroLoadout } from '../domain/types'
import { WARDEN_ID } from '../domain/validation'
import { equipmentOwnerById } from './iconIndex'
import type { ModeEvidence } from './types'

export interface HeroInferenceResult {
  status: 'confirmed' | 'incomplete' | 'conflict'
  heroId?: number
  ownerIds: number[]
  message: string
}

export const inferHeroFromEquipment = (equipmentIds: number[]): HeroInferenceResult => {
  const ownerIds = equipmentIds
    .map((equipmentId) => equipmentOwnerById.get(equipmentId))
    .filter((ownerId): ownerId is number => ownerId !== undefined)
  const uniqueOwners = [...new Set(ownerIds)]
  if (equipmentIds.length !== 2 || ownerIds.length !== 2) {
    return { status: 'incomplete', ownerIds: uniqueOwners, message: '需要识别两件有效装备才能确定英雄' }
  }
  if (uniqueOwners.length !== 1) {
    return { status: 'conflict', ownerIds: uniqueOwners, message: '两件装备属于不同英雄，需要人工确认' }
  }
  const hero = gameData.heroById.get(uniqueOwners[0])
  return { status: 'confirmed', heroId: uniqueOwners[0], ownerIds: uniqueOwners, message: `由装备归属确定为${hero?.displayName ?? '未知英雄'}` }
}

export const createLoadoutFromEvidence = (equipmentIds: number[], petId: number | undefined, mode: ModeEvidence): HeroLoadout | undefined => {
  const inference = inferHeroFromEquipment(equipmentIds)
  if (inference.heroId === undefined) return undefined
  return {
    heroId: inference.heroId,
    equipmentIds,
    ...(petId === undefined ? {} : { petId }),
    ...(inference.heroId === WARDEN_ID && mode.value !== undefined ? { mode: mode.value } : {}),
  }
}
