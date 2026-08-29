import { gameData } from '../data/gameData'
import type { HeroLoadout } from '../domain/types'
import { WARDEN_ID } from '../domain/validation'
import { equipmentOwnerById } from './iconIndex'
import type { ModeEvidence } from './types'

export interface RankedVisualCandidate {
  id: number
  score: number
  source?: 'onnx' | 'template'
}

export interface EquipmentPairCandidate {
  heroId: number
  left: RankedVisualCandidate
  right: RankedVisualCandidate
  score: number
}

export type HeroEquipmentResolutionStatus = 'confirmed-candidate' | 'ambiguous' | 'unrecognized'

export interface HeroEquipmentResolution {
  heroId?: number
  selectedIds: Array<number | undefined>
  score: number
  gap: number
  status: HeroEquipmentResolutionStatus
  diagnostics: string[]
}

export interface UniqueVisualResolution {
  selectedId?: number
  score: number
  gap: number
  status: 'confirmed-candidate' | 'ambiguous' | 'unrecognized'
  diagnostics: string[]
}

const MAX_PAIR_OPTIONS = 32
const MIN_PAIR_SCORE = .52
const AMBIGUOUS_PAIR_GAP = .035

const pairOptionsFor = (slots: Array<RankedVisualCandidate[]>): EquipmentPairCandidate[] => {
  if (slots.length !== 2) return []
  const options: EquipmentPairCandidate[] = []
  for (const left of slots[0]) for (const right of slots[1]) {
    if (left.id === right.id) continue
    const leftOwner = equipmentOwnerById.get(left.id)
    const rightOwner = equipmentOwnerById.get(right.id)
    if (leftOwner === undefined || leftOwner !== rightOwner) continue
    options.push({ heroId: leftOwner, left, right, score: (left.score + right.score) / 2 })
  }
  return options
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, all) => all.findIndex((other) =>
      other.heroId === candidate.heroId && other.left.id === candidate.left.id && other.right.id === candidate.right.id,
    ) === index)
    .slice(0, MAX_PAIR_OPTIONS)
}

interface EquipmentAssignment {
  total: number
  selections: Array<EquipmentPairCandidate | undefined>
}

const assignUniqueHeroPairs = (options: EquipmentPairCandidate[][]) => {
  const assignments: EquipmentAssignment[] = []
  const visit = (index: number, usedHeroes: Set<number>, selections: Array<EquipmentPairCandidate | undefined>, total: number) => {
    if (index >= options.length) {
      assignments.push({ total, selections: [...selections] })
      return
    }
    // Unknown is a real branch, so one weak or conflicting column cannot force
    // a duplicate hero into the final result.
    selections.push(undefined)
    visit(index + 1, usedHeroes, selections, total)
    selections.pop()
    for (const option of options[index]) {
      if (usedHeroes.has(option.heroId)) continue
      usedHeroes.add(option.heroId)
      selections.push(option)
      visit(index + 1, usedHeroes, selections, total + option.score)
      selections.pop()
      usedHeroes.delete(option.heroId)
    }
  }
  visit(0, new Set(), [], 0)
  return assignments.sort((left, right) => right.total - left.total)
}

/**
 * Resolves all hero columns together. The result is deliberately independent
 * from any image/model implementation so template and ONNX recognition share
 * exactly the same four-column uniqueness rules.
 */
export const resolveHeroEquipmentGlobally = (slotsByColumn: Array<Array<RankedVisualCandidate[]>>): HeroEquipmentResolution[] => {
  const options = slotsByColumn.map(pairOptionsFor)
  const assignments = assignUniqueHeroPairs(options)
  const best = assignments[0]
  const second = assignments.find((candidate) => candidate.selections.some((selection, index) => {
    const selected = best?.selections[index]
    return (selection?.heroId ?? undefined) !== (selected?.heroId ?? undefined)
      || (selection?.left.id ?? undefined) !== (selected?.left.id ?? undefined)
      || (selection?.right.id ?? undefined) !== (selected?.right.id ?? undefined)
  }))
  const globalGap = best && second ? Math.max(0, best.total - second.total) : best ? best.total : 0

  return options.map((columnOptions, index) => {
    const selected = best?.selections[index]
    if (!selected || selected.score < MIN_PAIR_SCORE) {
      return {
        selectedIds: [undefined, undefined], score: selected?.score ?? 0, gap: globalGap,
        status: 'unrecognized', diagnostics: ['no-reliable-global-equipment-pair'],
      }
    }
    const localAlternative = columnOptions.find((candidate) => candidate !== selected && candidate.heroId !== selected.heroId)
      ?? columnOptions.find((candidate) => candidate !== selected)
    const localGap = selected.score - (localAlternative?.score ?? 0)
    const ambiguous = localGap < AMBIGUOUS_PAIR_GAP || (assignments.length > 1 && globalGap < AMBIGUOUS_PAIR_GAP)
    return {
      heroId: selected.heroId,
      selectedIds: [selected.left.id, selected.right.id],
      score: selected.score,
      gap: Math.min(localGap, globalGap || localGap),
      status: ambiguous ? 'ambiguous' : 'confirmed-candidate',
      diagnostics: [
        `global-equipment-pair:${selected.left.id},${selected.right.id}`,
        ...(ambiguous ? ['global-equipment-assignment-ambiguous'] : []),
      ],
    }
  })
}

/** Assigns at most one instance of a visual item to each column. */
export const resolveUniqueVisualCandidates = (candidatesByColumn: Array<RankedVisualCandidate[]>): UniqueVisualResolution[] => {
  const options = candidatesByColumn.map((candidates) => candidates.filter((candidate) => candidate.score >= .60).slice(0, 8))
  const assignments: Array<{ total: number, selections: Array<RankedVisualCandidate | undefined> }> = []
  const visit = (index: number, used: Set<number>, selections: Array<RankedVisualCandidate | undefined>, total: number) => {
    if (index >= options.length) {
      assignments.push({ total, selections: [...selections] })
      return
    }
    selections.push(undefined)
    visit(index + 1, used, selections, total)
    selections.pop()
    for (const candidate of options[index]) {
      if (used.has(candidate.id)) continue
      used.add(candidate.id)
      selections.push(candidate)
      visit(index + 1, used, selections, total + candidate.score)
      selections.pop()
      used.delete(candidate.id)
    }
  }
  visit(0, new Set(), [], 0)
  assignments.sort((left, right) => right.total - left.total)
  const best = assignments[0]
  const globalGap = best && assignments[1] ? best.total - assignments[1].total : best?.total ?? 0
  return options.map((columnOptions, index) => {
    const selected = best?.selections[index]
    if (!selected) return { score: 0, gap: globalGap, status: 'unrecognized', diagnostics: ['no-reliable-unique-candidate'] }
    const alternative = columnOptions.find((candidate) => candidate !== selected)
    const localGap = selected.score - (alternative?.score ?? 0)
    const ambiguous = localGap < .04 || (assignments.length > 1 && globalGap < .04)
    return {
      selectedId: selected.id,
      score: selected.score,
      gap: Math.min(localGap, globalGap || localGap),
      status: ambiguous ? 'ambiguous' : 'confirmed-candidate',
      diagnostics: [
        `unique-candidate:${selected.id}`,
        ...(ambiguous ? ['unique-candidate-ambiguous'] : []),
      ],
    }
  })
}

export interface HeroInferenceResult {
  status: 'confirmed' | 'incomplete' | 'conflict'
  heroId?: number
  ownerIds: number[]
  message: string
}

export const inferHeroFromEquipment = (equipmentIds: number[]): HeroInferenceResult => {
  if (equipmentIds.length === 2 && new Set(equipmentIds).size !== equipmentIds.length) {
    return { status: 'incomplete', ownerIds: [], message: '需要两件不同装备才能确定英雄' }
  }
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
