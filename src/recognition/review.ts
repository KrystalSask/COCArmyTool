import type { ArmyComposition, CountEntry } from '../domain/types'
import type { RecognizedCard, RecognizedHeroSlot, RecognitionReview, ScreenshotRecognitionResult } from './types'

const mergeEntries = (cards: RecognizedCard[]): CountEntry[] => {
  const counts = new Map<number, number>()
  cards.forEach((card) => counts.set(card.selectedId, (counts.get(card.selectedId) ?? 0) + card.count))
  return [...counts].map(([id, count]) => ({ id, count }))
}

export const compositionFromRecognition = (result: ScreenshotRecognitionResult): ArmyComposition => ({
  heroes: result.heroes.map((hero) => ({ ...hero.loadout, equipmentIds: [...hero.loadout.equipmentIds] })),
  troops: mergeEntries(result.cards.filter((card) => card.region === 'mainTroops' || card.region === 'mainSiege')),
  spells: mergeEntries(result.cards.filter((card) => card.region === 'mainSpells')),
  clanCastleTroops: mergeEntries(result.cards.filter((card) => card.region === 'castleArmy' && card.selectedKind !== 'spell')),
  clanCastleSpells: mergeEntries(result.cards.filter((card) => card.region === 'castleArmy' && card.selectedKind === 'spell')),
})

export const buildRecognitionReview = (result: ScreenshotRecognitionResult): RecognitionReview => ({
  result,
  composition: compositionFromRecognition(result),
  unresolvedKeys: [
    ...result.cards.filter((card) => !card.confirmed || Boolean(card.issue)).map((card) => card.key),
    ...result.heroes.filter((hero) => !hero.confirmed || Boolean(hero.issue)).map((hero) => hero.key),
  ],
})

export const updateRecognizedCard = (result: ScreenshotRecognitionResult, key: string, update: Partial<Pick<RecognizedCard, 'selectedId' | 'selectedKind' | 'count' | 'confirmed' | 'issue'>>): ScreenshotRecognitionResult => ({
  ...result,
  cards: result.cards.map((card) => card.key === key ? { ...card, ...update } : card),
})

export const updateRecognizedHero = (result: ScreenshotRecognitionResult, key: string, update: Partial<Pick<RecognizedHeroSlot, 'loadout' | 'confirmed' | 'issue' | 'mode'>>): ScreenshotRecognitionResult => ({
  ...result,
  heroes: result.heroes.map((hero) => hero.key === key ? { ...hero, ...update } : hero),
})

export const confirmAllMockCandidates = (result: ScreenshotRecognitionResult): ScreenshotRecognitionResult => ({
  ...result,
  cards: result.cards.map((card) => ({ ...card, confirmed: true, issue: undefined })),
  heroes: result.heroes.map((hero) => ({
    ...hero,
    confirmed: true,
    issue: undefined,
    mode: { ...hero.mode, confirmed: true },
  })),
})
