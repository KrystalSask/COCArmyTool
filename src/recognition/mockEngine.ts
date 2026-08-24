import { gameData, isSiegeMachine } from '../data/gameData'
import { parseArmyLink } from '../domain/armyLink'
import type { CountEntry, GameItem, ItemKind } from '../domain/types'
import { inferHeroFromEquipment } from './heroInference'
import { getLayoutDefinition, projectLayoutToPanel, recognitionLayouts } from './layouts'
import type { ItemCandidate, LayoutRegion, NormalizedRect, RecognizedCard, RecognizedHeroSlot, ScreenshotPreflight, ScreenshotRecognitionEngine } from './types'

export const MOCK_RECOGNITION_LINK = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'

const candidatesFor = (item: GameItem): ItemCandidate[] => {
  const pool = ({
    troop: gameData.troops,
    siege: gameData.siegeMachines,
    spell: gameData.spells,
  } as Partial<Record<ItemKind, GameItem[]>>)[item.kind] ?? []
  return [item, ...pool.filter((candidate) => candidate.id !== item.id).slice(0, 2)]
    .map((candidate, index) => ({ id: candidate.id, kind: candidate.kind, score: [.94, .71, .53][index] }))
}

const distributeRect = (region: LayoutRegion, index: number, total: number): NormalizedRect => {
  const columns = Math.max(1, total)
  const gap = region.rect.width * .012
  const width = Math.min(region.rect.width * .17, (region.rect.width - gap * (columns - 1)) / columns)
  return {
    x: region.rect.x + index * (width + gap),
    y: region.rect.y + region.rect.height * .14,
    width,
    height: region.rect.height * .72,
  }
}

const makeCards = (entries: CountEntry[], region: LayoutRegion, lookup: Map<number, GameItem>, confidenceOffset: number): RecognizedCard[] => entries.map((entry, index) => {
  const item = lookup.get(entry.id)
  if (!item) throw new Error(`模拟识别数据缺少 ${region.kind} ID ${entry.id}`)
  const confidence = Math.min(.97, .76 + index * .055 + confidenceOffset)
  const countCandidates = [
    { value: entry.count, score: confidence },
    { value: Math.max(1, entry.count - 2), score: .42 },
    { value: entry.count + 2, score: .31 },
  ].filter((candidate, candidateIndex, candidates) => candidates.findIndex((other) => other.value === candidate.value) === candidateIndex)
  return {
    key: `${region.kind}-${entry.id}-${index}`,
    region: region.kind as RecognizedCard['region'],
    rect: distributeRect(region, index, entries.length),
    selectedId: item.id,
    selectedKind: item.kind as RecognizedCard['selectedKind'],
    count: entry.count,
    itemCandidates: candidatesFor(item),
    countCandidates,
    confidence,
    confirmed: confidence >= .9,
    ignoreLevel: true,
    ...(confidence >= .9 ? {} : { issue: '模拟低置信度：请核对单位与左上角数量' }),
  }
})

const region = (regions: LayoutRegion[], kind: LayoutRegion['kind']) => {
  const found = regions.find((candidate) => candidate.kind === kind)
  if (!found) throw new Error(`布局缺少 ${kind} 区域`)
  return found
}

export const createMockRecognitionResult = (preflight: ScreenshotPreflight) => {
  const composition = parseArmyLink(MOCK_RECOGNITION_LINK)
  const layout = preflight.layout === 'unknown' ? 'saved' : preflight.layout
  const definition = getLayoutDefinition(layout) ?? recognitionLayouts.saved
  const projected = projectLayoutToPanel(definition, preflight.panel)
  const mainTroops = composition.troops.filter((entry) => !isSiegeMachine(entry.id))
  const mainSiege = composition.troops.filter((entry) => isSiegeMachine(entry.id))
  const castleTroops = composition.clanCastleTroops.filter((entry) => !isSiegeMachine(entry.id))
  const castleSiege = composition.clanCastleTroops.filter((entry) => isSiegeMachine(entry.id))
  const castleRegion = region(projected.regions, 'castleArmy')
  const castleCardsRaw = [
    ...makeCards(composition.clanCastleSpells, castleRegion, gameData.spellById, .01),
    ...makeCards(castleTroops, castleRegion, gameData.troopById, .04),
    ...makeCards(castleSiege, castleRegion, gameData.siegeById, .02),
  ]
  const castleCards = castleCardsRaw.map((card, index) => ({ ...card, rect: distributeRect(castleRegion, index, castleCardsRaw.length) }))
  const cards = [
    ...makeCards(mainTroops, region(projected.regions, 'mainTroops'), gameData.troopById, 0),
    ...makeCards(composition.spells, region(projected.regions, 'mainSpells'), gameData.spellById, .03),
    ...makeCards(mainSiege, region(projected.regions, 'mainSiege'), gameData.siegeById, .02),
    ...castleCards,
  ]
  const heroRegion = region(projected.regions, 'heroes')
  const heroes: RecognizedHeroSlot[] = composition.heroes.map((loadout, index) => {
    const inference = inferHeroFromEquipment(loadout.equipmentIds)
    const isWarden = loadout.heroId === 2
    return {
      key: `hero-${index}`,
      rect: distributeRect(heroRegion, index, composition.heroes.length),
      loadout: { ...loadout, equipmentIds: [...loadout.equipmentIds] },
      equipmentScores: [.96, .94],
      petScore: .93,
      mode: { value: loadout.mode as 0 | 1 | undefined, score: isWarden ? .79 : 1, confirmed: !isWarden },
      confidence: isWarden ? .79 : .93,
      confirmed: !isWarden,
      inference: inference.status === 'confirmed' ? 'equipment-owner' : inference.status,
      ...(isWarden ? { issue: '请确认大守护者右上角模式标志' } : {}),
    }
  })
  return {
    engine: 'mock' as const,
    layout,
    panel: projected.panel,
    anchors: projected.anchors,
    regions: projected.regions,
    cards,
    heroes,
    warnings: ['当前为模拟识别结果，仅用于验证上传、候选校正、规则校验与导出管线，不代表截图真实内容。'],
    createdAt: new Date().toISOString(),
  }
}

export const mockRecognitionEngine: ScreenshotRecognitionEngine = {
  id: 'mock-layout-pipeline',
  async recognize(_file, preflight) {
    return createMockRecognitionResult(preflight)
  },
}
