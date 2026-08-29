import type { ArmyComposition, CountEntry } from '../domain/types'
import { WARDEN_ID } from '../domain/validation'
import { inferHeroFromEquipment } from './heroInference'
import type { HeroUnresolvedKind, RecognizedCard, RecognizedHeroSlot, RecognitionReview, ScreenshotRecognitionResult } from './types'

const mergeEntries = (cards: RecognizedCard[]): CountEntry[] => {
  const counts = new Map<number, number>()
  cards.forEach((card) => {
    if (card.count !== undefined) counts.set(card.selectedId, (counts.get(card.selectedId) ?? 0) + card.count)
  })
  return [...counts].map(([id, count]) => ({ id, count }))
}

export const compositionFromRecognition = (result: ScreenshotRecognitionResult): ArmyComposition => ({
  heroes: (() => {
    const usedHeroes = new Set<number>()
    const usedPets = new Set<number>()
    return result.heroes
    // 不完整的英雄列只留在审查证据中，绝不进入最终配兵。
    .filter((hero) => hero.loadout.heroId !== undefined && hero.loadout.petId !== undefined
      && hero.loadout.equipmentIds.length === 2 && hero.loadout.equipmentIds.every((id) => id !== undefined))
    .filter((hero) => {
      const heroId = hero.loadout.heroId as number
      const petId = hero.loadout.petId as number
      if (usedHeroes.has(heroId) || usedPets.has(petId)) return false
      usedHeroes.add(heroId)
      usedPets.add(petId)
      return true
    })
    .map((hero) => ({
      heroId: hero.loadout.heroId as number,
      ...(hero.loadout.mode === undefined ? {} : { mode: hero.loadout.mode }),
      petId: hero.loadout.petId as number,
      equipmentIds: hero.loadout.equipmentIds as number[],
    }))
  })(),
  troops: mergeEntries(result.cards.filter((card) => card.region === 'mainTroops' || card.region === 'mainSiege')),
  spells: mergeEntries(result.cards.filter((card) => card.region === 'mainSpells')),
  clanCastleTroops: mergeEntries(result.cards.filter((card) => card.region === 'castleArmy' && card.selectedKind !== 'spell')),
  clanCastleSpells: mergeEntries(result.cards.filter((card) => card.region === 'castleArmy' && card.selectedKind === 'spell')),
})

const withUniqueHeroConflicts = (result: ScreenshotRecognitionResult): ScreenshotRecognitionResult => {
  const heroesById = new Map<number, string[]>()
  const petsById = new Map<number, string[]>()
  result.heroes.forEach((hero) => {
    if (hero.loadout.heroId !== undefined) heroesById.set(hero.loadout.heroId, [...(heroesById.get(hero.loadout.heroId) ?? []), hero.key])
    if (hero.loadout.petId !== undefined) petsById.set(hero.loadout.petId, [...(petsById.get(hero.loadout.petId) ?? []), hero.key])
  })
  return {
    ...result,
    heroes: result.heroes.map((hero) => {
      const duplicateHero = hero.loadout.heroId !== undefined && (heroesById.get(hero.loadout.heroId)?.length ?? 0) > 1
      const duplicatePet = hero.loadout.petId !== undefined && (petsById.get(hero.loadout.petId)?.length ?? 0) > 1
      if (!duplicateHero && !duplicatePet) return hero
      const conflictingKeys = [
        ...(duplicateHero ? [`英雄与 ${heroesById.get(hero.loadout.heroId!)!.filter((key) => key !== hero.key).join('、')} 重复`] : []),
        ...(duplicatePet ? [`战宠与 ${petsById.get(hero.loadout.petId!)!.filter((key) => key !== hero.key).join('、')} 重复`] : []),
      ]
      return {
        ...hero,
        confirmed: false,
        issueKind: duplicateHero ? 'duplicate-hero' : 'duplicate-pet',
        issue: `${conflictingKeys.join('；')}，需要人工调整。`,
      }
    }),
  }
}

export const buildRecognitionReview = (result: ScreenshotRecognitionResult): RecognitionReview => {
  const normalizedResult = withUniqueHeroConflicts(result)
  return {
  result: normalizedResult,
  composition: compositionFromRecognition(normalizedResult),
  unresolvedKeys: [
    ...normalizedResult.cards.filter((card) => !card.confirmed || Boolean(card.issue)).map((card) => card.key),
    ...normalizedResult.heroes.filter((hero) => !hero.confirmed || Boolean(hero.issue)).map((hero) => hero.key),
  ],
  }
}

export const updateRecognizedCard = (result: ScreenshotRecognitionResult, key: string, update: Partial<Pick<RecognizedCard, 'selectedId' | 'selectedKind' | 'count' | 'confirmed' | 'issue' | 'issueKind'>>): ScreenshotRecognitionResult => ({
  ...result,
  cards: result.cards.map((card) => card.key === key ? { ...card, ...update } : card),
})

// 英雄子证据的稳定键：hero-N-equipment-0/1、hero-N-pet。覆盖层与审查面板
// 用同一套键实现双向精确定位。
export const heroEquipmentKey = (heroKey: string, equipmentIndex: number) => `${heroKey}-equipment-${equipmentIndex}`
export const heroPetKey = (heroKey: string) => `${heroKey}-pet`

export const updateRecognizedHero = (result: ScreenshotRecognitionResult, key: string, update: Partial<Pick<RecognizedHeroSlot, 'loadout' | 'confirmed' | 'issue' | 'issueKind' | 'mode' | 'equipment' | 'pet' | 'equipmentScores' | 'petScore' | 'confidence' | 'inference'>>): ScreenshotRecognitionResult => ({
  ...result,
  heroes: result.heroes.map((hero) => hero.key === key ? { ...hero, ...update } : hero),
})

const refreshHeroStatus = (hero: RecognizedHeroSlot): RecognizedHeroSlot => {
  const equipmentIds = [...hero.loadout.equipmentIds]
  const inference = inferHeroFromEquipment(equipmentIds.filter((id): id is number => id !== undefined))
  const heroId = inference.status === 'confirmed' ? inference.heroId : undefined
  const petScore = hero.pet?.candidates[0]?.score ?? hero.petScore
  const modeDefined = heroId === WARDEN_ID ? hero.loadout.mode !== undefined : true
  const unresolved = heroUnresolvedFromEvidence(heroId, equipmentIds, hero.loadout.petId, petScore, modeDefined)
  return {
    ...hero,
    loadout: {
      ...hero.loadout,
      heroId,
      ...(heroId === WARDEN_ID ? { mode: hero.loadout.mode } : { mode: undefined }),
    },
    inference: inference.status === 'confirmed' ? 'equipment-owner' : inference.status,
    confirmed: false,
    issue: unresolved.issue,
    issueKind: unresolved.issueKind,
  }
}

export const updateRecognizedHeroEquipment = (result: ScreenshotRecognitionResult, key: string, equipmentIndex: number, equipmentId: number): ScreenshotRecognitionResult => {
  const hero = result.heroes.find((candidate) => candidate.key === key)
  if (!hero) return result
  const equipmentIds = [...hero.loadout.equipmentIds]
  equipmentIds[equipmentIndex] = equipmentId
  const equipment = (hero.equipment ?? []).map((item, index) => index === equipmentIndex
    ? { ...item, selectedId: equipmentId, score: item.candidates.find((candidate) => candidate.id === equipmentId)?.score ?? 1 }
    : item)
  const equipmentScores = equipment.map((item) => item.score)
  const withEvidence = updateRecognizedHero(result, key, { loadout: { ...hero.loadout, equipmentIds }, equipment, equipmentScores })
  const updated = withEvidence.heroes.find((candidate) => candidate.key === key)
  return updated ? updateRecognizedHero(withEvidence, key, refreshHeroStatus(updated)) : withEvidence
}

export const updateRecognizedHeroPet = (result: ScreenshotRecognitionResult, key: string, petId: number): ScreenshotRecognitionResult => {
  const hero = result.heroes.find((candidate) => candidate.key === key)
  if (!hero) return result
  const pet = hero.pet
    ? {
      ...hero.pet,
      selectedId: petId,
      score: hero.pet.candidates.find((candidate) => candidate.id === petId)?.score ?? 1,
    }
    : undefined
  const withEvidence = updateRecognizedHero(result, key, {
    loadout: { ...hero.loadout, petId },
    ...(pet ? { pet, petScore: pet.score } : {}),
  })
  const updated = withEvidence.heroes.find((candidate) => candidate.key === key)
  return updated ? updateRecognizedHero(withEvidence, key, refreshHeroStatus(updated)) : withEvidence
}

export const updateRecognizedHeroMode = (result: ScreenshotRecognitionResult, key: string, modeValue: 0 | 1): ScreenshotRecognitionResult => {
  const hero = result.heroes.find((candidate) => candidate.key === key)
  if (!hero) return result
  const withEvidence = updateRecognizedHero(result, key, {
    loadout: { ...hero.loadout, mode: modeValue },
    mode: { value: modeValue, score: 1, confirmed: true },
  })
  const updated = withEvidence.heroes.find((candidate) => candidate.key === key)
  return updated ? updateRecognizedHero(withEvidence, key, refreshHeroStatus(updated)) : withEvidence
}

// 由当前证据推导英雄行的未解决原因：至少区分装备缺失、装备冲突、战宠
// 缺失/低置信度、大守护者模式缺失与普通未确认。
export const heroUnresolvedFromEvidence = (
  heroId: number | undefined,
  equipmentIds: Array<number | undefined>,
  petId: number | undefined,
  petTopScore: number,
  wardenModeDefined: boolean,
): { issue: string, issueKind: HeroUnresolvedKind } => {
  if (equipmentIds.some((id) => id === undefined)) {
    return {
      issueKind: 'incomplete-equipment',
      issue: '有装备未能识别；请为每件装备选择一项。',
    }
  }
  if (equipmentIds.length === 2 && new Set(equipmentIds).size !== equipmentIds.length) {
    return { issueKind: 'duplicate-equipment', issue: '两件装备不能重复，请选择不同装备。' }
  }
  if (heroId === undefined) {
    return { issueKind: 'equipment-conflict', issue: '两件装备属于不同英雄，需要人工确认英雄归属。' }
  }
  if (petId === undefined) {
    return {
      issueKind: petTopScore >= .55 ? 'low-confidence-pet' : 'missing-pet',
      issue: petTopScore >= .55 ? '战宠候选置信度较低，请核对并选择战宠。' : '战宠未能自动识别，请选择战宠。',
    }
  }
  if (heroId === WARDEN_ID && !wardenModeDefined) {
    return { issueKind: 'missing-mode', issue: '大守护者模式标志未能识别，请确认地面或空中模式。' }
  }
  return { issueKind: 'unconfirmed', issue: '英雄由两件装备共同归属推断；请核对战宠、装备与模式。' }
}

export const canConfirmAllCandidates = (result: ScreenshotRecognitionResult) => result.cards.length > 0
  // 数量缺失不再阻塞批量确认（补填数量时逐卡自动确认）；低置信度卡片
  // 仍必须逐卡人工核对，防止低质量 OCR 直接进入批量确认与训练样本。
  // 注意：本闸门必须始终严于 confirmAllCandidates 的确认动作——
  // 低置信度卡不允许被批量确认绕过。
  && result.cards.every((card) => card.confidence >= .75)
  && result.heroes.length === 4
  && result.heroes.every((hero) => hero.loadout.petId !== undefined
    && hero.loadout.equipmentIds.length === 2
    && new Set(hero.loadout.equipmentIds).size === 2
    && hero.loadout.equipmentIds.every((id) => id !== undefined)
    && hero.loadout.heroId !== undefined
    && (hero.loadout.heroId !== WARDEN_ID || hero.loadout.mode !== undefined))
  && new Set(result.heroes.map((hero) => hero.loadout.heroId)).size === result.heroes.length
  && new Set(result.heroes.map((hero) => hero.loadout.petId)).size === result.heroes.length

// 只确认证据完整的项目；不完整英雄列保持未解决并留在审查中。
export const confirmAllCandidates = (result: ScreenshotRecognitionResult): ScreenshotRecognitionResult => ({
  ...result,
  cards: result.cards.map((card) => card.count === undefined
    ? card
    : ({ ...card, confirmed: true, issue: undefined, issueKind: undefined })),
  heroes: result.heroes.map((hero) => {
    const complete = hero.loadout.heroId !== undefined && hero.loadout.petId !== undefined
      && hero.loadout.equipmentIds.length === 2 && hero.loadout.equipmentIds.every((id) => id !== undefined)
      && new Set(hero.loadout.equipmentIds).size === 2
      && (hero.loadout.heroId !== WARDEN_ID || hero.loadout.mode !== undefined)
    return complete
      ? { ...hero, confirmed: true, issue: undefined, issueKind: undefined, mode: { ...hero.mode, confirmed: true } }
      : hero
  }),
})

export const confirmAllMockCandidates = confirmAllCandidates

// 手动增删卡片：类别识别错误时人工校正。增删只改 result.cards，
// 配兵合成（compositionFromRecognition）与容量校验按 cards 自动重建。

export const removeRecognizedCard = (result: ScreenshotRecognitionResult, key: string): ScreenshotRecognitionResult => ({
  ...result,
  cards: result.cards.filter((card) => card.key !== key),
})

export interface ManualCardInput {
  region: RecognizedCard['region']
  selectedKind: RecognizedCard['selectedKind']
  selectedId: number
  count?: number
}

// 手动卡没有真实截图矩形（rect 用零值占位，覆盖层按 manual 跳过渲染）；
// 无 OCR 候选，置信度视为人工可信。填了数量即确认，否则进入待填列表。
let manualCardSeq = 0

export const addRecognizedCard = (result: ScreenshotRecognitionResult, input: ManualCardInput): ScreenshotRecognitionResult => ({
  ...result,
  cards: [...result.cards, {
    key: `manual-${Date.now().toString(36)}-${manualCardSeq++}`,
    region: input.region,
    rect: { x: .5, y: .5, width: 0, height: 0 },
    selectedId: input.selectedId,
    selectedKind: input.selectedKind,
    ...(input.count === undefined ? {} : { count: input.count }),
    itemCandidates: [],
    countCandidates: [],
    confidence: 1,
    confirmed: input.count !== undefined,
    ignoreLevel: true,
    ...(input.count === undefined ? { issue: '请填写有效数量后确认。', issueKind: 'missing-count' as const } : {}),
    manual: true,
  }],
})
