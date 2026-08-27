import { gameData, isSiegeMachine } from '../data/gameData'
import { LIMITS } from '../domain/validation'
import type { DetectedCardSlot } from './cardDetector'
import type { RecognitionRegionKind } from './types'

type CardRegion = Exclude<RecognitionRegionKind, 'heroes'>
type CapacityVector = [number, number, number]

export interface RecognitionRuleIssue {
  code: 'duplicate-category' | 'capacity-mismatch' | 'capacity-unverifiable'
  severity: 'warning'
  message: string
  slotIndexes: number[]
}

export interface RecognitionRuleValidation {
  issues: RecognitionRuleIssue[]
  suggestions: Array<{
    kind: 'count' | 'category'
    slotIndex: number
    message: string
    value?: number
    item?: { id: number, kind: 'troop' | 'siege' | 'spell' }
  }>
}

const addVector = (left: CapacityVector, right: CapacityVector): CapacityVector => [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
const vectorKey = (value: CapacityVector) => value.join(':')

const targetFor = (region: CardRegion): CapacityVector => region === 'mainTroops'
  ? [LIMITS.army, 0, 0]
  : region === 'mainSpells'
    ? [0, LIMITS.spells, 0]
    : region === 'mainSiege'
      ? [0, 0, LIMITS.siegeMachines]
      : [LIMITS.clanCastleTroops, LIMITS.clanCastleSpells, LIMITS.clanCastleSiegeMachines]

type ItemCandidate = NonNullable<DetectedCardSlot['candidates']>[number]

const contribution = (item: ItemCandidate, count: number): CapacityVector => {
  if (item.kind === 'spell') return [0, (gameData.spellById.get(item.id)?.housingSpace ?? 0) * count, 0]
  if (item.kind === 'siege' || isSiegeMachine(item.id)) return [0, 0, count]
  return [(gameData.troopById.get(item.id)?.housingSpace ?? 0) * count, 0, 0]
}

const withinTarget = (value: CapacityVector, target: CapacityVector) => value.every((part, index) => part <= target[index])

const itemKey = (item: ItemCandidate) => `${item.kind}:${item.id}`

/**
 * A game row cannot contain the same item in two separate cards. When visual
 * top-1 results collide, keep the card with the larger quantity (then the
 * stronger score) and promote the first unused alternative on the other card.
 */
export const resolveDuplicateItemCandidates = (slots: DetectedCardSlot[]) => {
  const resolved = slots.map((slot) => ({ ...slot, candidates: slot.candidates ? [...slot.candidates] : slot.candidates }))
  const groups = new Map<string, number[]>()
  resolved.forEach((slot, index) => {
    const selected = slot.candidates?.[0]
    if (!selected) return
    const key = itemKey(selected)
    groups.set(key, [...(groups.get(key) ?? []), index])
  })
  // Reserve every current top-1 key up front so a promoted alternative cannot
  // collide with another duplicate group that will be processed later.
  const occupied = new Set(groups.keys())
  for (const [duplicateKey, indexes] of groups) {
    if (indexes.length < 2) {
      occupied.add(duplicateKey)
      continue
    }
    const [keeper, ...duplicates] = [...indexes].sort((left, right) => {
      const countDifference = (resolved[right].count?.value ?? -1) - (resolved[left].count?.value ?? -1)
      return countDifference || (resolved[right].candidates?.[0]?.score ?? 0) - (resolved[left].candidates?.[0]?.score ?? 0)
    })
    occupied.add(duplicateKey)
    for (const index of duplicates) {
      const candidates = resolved[index].candidates ?? []
      const alternative = candidates.slice(1).find((candidate) => !occupied.has(itemKey(candidate)))
      if (!alternative) continue
      resolved[index] = {
        ...resolved[index],
        categoryConstrained: true,
        candidates: [alternative, ...candidates.filter((candidate) => itemKey(candidate) !== itemKey(alternative))],
      }
      occupied.add(itemKey(alternative))
    }
    // Keep the selected card explicit for deterministic ties and later groups.
    occupied.add(itemKey(resolved[keeper].candidates![0]))
  }
  return resolved
}

/** Select quantity alternatives only when all visible cards exactly satisfy the game's capacity anchors. */
export const constrainCountsToCapacity = (region: CardRegion, slots: DetectedCardSlot[]) => {
  if (!slots.length || slots.some((slot) => !slot.candidates?.[0])) return slots
  const missingCountIndexes = slots.map((slot, index) => !slot.count?.candidates?.length ? index : -1).filter((index) => index >= 0)
  const target = targetFor(region)
  let states = new Map<string, { vector: CapacityVector, score: number, choices: Array<{ item: ItemCandidate, count: number }> }>()
  states.set('0:0:0', { vector: [0, 0, 0], score: 0, choices: [] })
  for (const slot of slots) {
    const next = new Map<string, { vector: CapacityVector, score: number, choices: Array<{ item: ItemCandidate, count: number }> }>()
    // Spells have a small, strongly capacity-constrained catalog. Allow the
    // visual top-3 to participate so a cropped lightning card can beat a
    // visually similar newer spell when only that combination reaches 11/11.
    const items = region === 'castleArmy'
      ? slot.candidates!
      : region === 'mainSpells'
        ? slot.candidates!.slice(0, 3)
        : slot.candidates!.slice(0, 1)
    const counts = slot.count?.candidates?.length
      ? slot.count.candidates.slice(0, region === 'castleArmy' ? 3 : 6)
      : Array.from({ length: 99 }, (_, index) => ({ value: index + 1, score: .35 }))
    for (const state of states.values()) for (const item of items) for (const candidate of counts) {
      const itemKey = `${item.kind}:${item.id}`
      if (state.choices.some((choice) => `${choice.item.kind}:${choice.item.id}` === itemKey)) continue
      const vector = addVector(state.vector, contribution(item, candidate.value))
      if (!withinTarget(vector, target)) continue
      const score = state.score + Math.log(Math.max(candidate.score, .001)) + Math.log(Math.max(item.score, .001))
      const used = region === 'castleArmy'
        ? `|${[...state.choices.map((choice) => `${choice.item.kind}:${choice.item.id}`), itemKey].sort().join(',')}`
        : ''
      const key = `${vectorKey(vector)}${used}`
      const previous = next.get(key)
      if (!previous || score > previous.score) next.set(key, { vector, score, choices: [...state.choices, { item, count: candidate.value }] })
    }
    states = next.size > 500
      ? new Map([...next.entries()].sort((left, right) => right[1].score - left[1].score).slice(0, 500))
      : next
    if (!states.size) return slots
  }
  const exact = [...states.values()]
    .filter((state) => vectorKey(state.vector) === vectorKey(target)
      && state.choices.filter((choice, index) => {
        const slot = slots[index]
        return choice.count !== slot.count?.value || choice.item.id !== slot.candidates?.[0]?.id || choice.item.kind !== slot.candidates?.[0]?.kind
      }).length <= 2)
  if (missingCountIndexes.length) {
    const inferredSignatures = new Set(exact.map((state) => missingCountIndexes
      .map((index) => `${state.choices[index]?.item.kind}:${state.choices[index]?.item.id}:${state.choices[index]?.count}`).join('|')))
    if (inferredSignatures.size !== 1) return slots
  }
  const resolved = exact.sort((left, right) => right.score - left.score)[0]
  if (!resolved) return slots
  return slots.map((slot, index) => {
    const choice = resolved.choices[index]
    const value = choice.count
    const selected = slot.count?.candidates?.find((candidate) => candidate.value === value)
    const itemChanged = choice.item.id !== slot.candidates![0].id || choice.item.kind !== slot.candidates![0].kind
    const originalCount = slot.count ?? { confidence: 0, digits: [] }
    return {
      ...slot,
      candidates: [choice.item, ...slot.candidates!.filter((item) => item.id !== choice.item.id || item.kind !== choice.item.kind)],
      count: {
        ...originalCount,
        value,
        candidates: originalCount.candidates?.length ? originalCount.candidates : [{ value, score: .35 }],
        confidence: selected?.score ?? (missingCountIndexes.includes(index) ? .35 : originalCount.confidence),
        constrained: itemChanged || value !== slot.count?.value,
      },
    }
  })
}

/**
 * Evaluate game rules without changing visual classification or OCR output.
 * Suggestions are deliberately separate so callers cannot accidentally treat
 * a rule inference as recognition evidence.
 */
export const validateCardRules = (region: CardRegion, slots: DetectedCardSlot[]): RecognitionRuleValidation => {
  const issues: RecognitionRuleIssue[] = []
  const suggestions: RecognitionRuleValidation['suggestions'] = []
  const duplicateGroups = new Map<string, number[]>()
  slots.forEach((slot, index) => {
    const selected = slot.candidates?.[0]
    if (!selected) return
    const key = itemKey(selected)
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), index])
  })
  for (const [key, indexes] of duplicateGroups) {
    if (indexes.length < 2) continue
    issues.push({
      code: 'duplicate-category', severity: 'warning', slotIndexes: indexes,
      message: `同一区域的第 ${indexes.map((index) => index + 1).join('、')} 张卡片均识别为 ${key}，请核对。`,
    })
    indexes.slice(1).forEach((index) => {
      const alternative = slots[index].candidates?.slice(1).find((candidate) => candidate.id !== slots[index].candidates?.[0]?.id || candidate.kind !== slots[index].candidates?.[0]?.kind)
      if (alternative) suggestions.push({
        kind: 'category', slotIndex: index, item: { id: alternative.id, kind: alternative.kind },
        message: `可核对候选 ${alternative.kind}:${alternative.id}，不会自动替换视觉 Top-1。`,
      })
    })
  }

  const missing = slots.map((slot, index) => slot.count?.value === undefined ? index : -1).filter((index) => index >= 0)
  if (missing.length) {
    issues.push({
      code: 'capacity-unverifiable', severity: 'warning', slotIndexes: missing,
      message: `第 ${missing.map((index) => index + 1).join('、')} 张卡片缺少数量，无法完成容量校验。`,
    })
    return { issues, suggestions }
  }

  const actual = slots.reduce<CapacityVector>((total, slot) => {
    const selected = slot.candidates?.[0]
    return selected ? addVector(total, contribution(selected, slot.count!.value!)) : total
  }, [0, 0, 0])
  const target = targetFor(region)
  if (vectorKey(actual) !== vectorKey(target)) issues.push({
    code: 'capacity-mismatch', severity: 'warning', slotIndexes: slots.map((_slot, index) => index),
    message: `视觉结果容量为 ${vectorKey(actual)}，与区域容量 ${vectorKey(target)} 不一致；保留视觉结果并要求人工核对。`,
  })
  return { issues, suggestions }
}

/** Explicit rollback-only path. Production's warn-only path must not call it. */
export const applyLegacyRuleCorrections = (region: CardRegion, slots: DetectedCardSlot[]) =>
  constrainCountsToCapacity(region, resolveDuplicateItemCandidates(slots))
