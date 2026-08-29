import { describe, expect, it } from 'vitest'
import {
  addRecognizedCard,
  buildRecognitionReview,
  canConfirmAllCandidates,
  confirmAllCandidates,
  removeRecognizedCard,
} from './review'
import type { RecognizedCard, ScreenshotRecognitionResult } from './types'

const card = (overrides: Partial<RecognizedCard> = {}): RecognizedCard => ({
  key: 'card-1',
  region: 'mainTroops',
  rect: { x: 0, y: 0, width: .1, height: .1 },
  selectedId: 2,
  selectedKind: 'troop',
  count: 12,
  itemCandidates: [{ id: 2, kind: 'troop', score: .9 }],
  countCandidates: [{ value: 12, score: .8 }],
  confidence: .85,
  confirmed: false,
  ignoreLevel: true,
  ...overrides,
})

const completeHero = (index: number, heroId: number, petId: number): ScreenshotRecognitionResult['heroes'][number] => ({
  key: `hero-${index}`,
  rect: { x: 0, y: 0, width: .1, height: .2 },
  loadout: { heroId, petId, equipmentIds: [100 + heroId, 200 + heroId] },
  equipmentScores: [.9, .9],
  petScore: .9,
  mode: { score: .9, confirmed: true },
  confidence: .9,
  confirmed: false,
  inference: 'equipment-owner',
})

// 四列证据完整且互不冲突的英雄行，满足批量确认闸门的英雄条件。
const completeHeroes = (): ScreenshotRecognitionResult['heroes'] => [
  completeHero(0, 1, 10), completeHero(1, 3, 11), completeHero(2, 4, 12), completeHero(3, 5, 13),
]

const result = (overrides: Partial<ScreenshotRecognitionResult> = {}): ScreenshotRecognitionResult => ({
  engine: 'visual',
  layout: 'saved',
  panel: { x: .1, y: .1, width: .8, height: .8 },
  anchors: [],
  regions: [],
  cards: [card()],
  heroes: completeHeroes(),
  warnings: [],
  createdAt: '2026-08-29T00:00:00.000Z',
  ...overrides,
})

describe('批量确认闸门', () => {
  it('缺数量的卡片不再阻塞一键确认', () => {
    const candidate = result({ cards: [card({ count: undefined })] })
    expect(canConfirmAllCandidates(candidate)).toBe(true)
  })

  it('低置信度卡片仍然阻塞一键确认', () => {
    const candidate = result({ cards: [card({ confidence: .5 })] })
    expect(canConfirmAllCandidates(candidate)).toBe(false)
  })

  it('低置信度卡片经人工确认后不再阻塞一键确认', () => {
    const candidate = result({ cards: [card({ confidence: .5, confirmed: true }), card({ key: 'card-2', confidence: .6, confirmed: true })] })
    expect(canConfirmAllCandidates(candidate)).toBe(true)
  })

  it('英雄列不完整时阻塞一键确认', () => {
    const candidate = result({ heroes: completeHeroes().slice(0, 3) })
    expect(canConfirmAllCandidates(candidate)).toBe(false)
  })

  it('confirmAllCandidates 只确认有数量的卡片，缺数量卡保持待填', () => {
    const candidate = result({ cards: [card(), card({ key: 'card-2', count: undefined, selectedId: 3 })] })
    const confirmed = confirmAllCandidates(candidate)
    expect(confirmed.cards[0].confirmed).toBe(true)
    expect(confirmed.cards[1].confirmed).toBe(false)
    expect(buildRecognitionReview(confirmed).unresolvedKeys).toEqual(['card-2'])
  })
})

describe('手动增删卡片', () => {
  it('添加带数量的手动卡直接确认并计入配兵', () => {
    const updated = addRecognizedCard(result({ cards: [] }), { region: 'mainSpells', selectedKind: 'spell', selectedId: 9, count: 3 })
    expect(updated.cards).toHaveLength(1)
    const added = updated.cards[0]
    expect(added.manual).toBe(true)
    expect(added.confirmed).toBe(true)
    expect(added.confidence).toBe(1)
    expect(buildRecognitionReview(updated).composition.spells).toEqual([{ id: 9, count: 3 }])
  })

  it('添加未填数量的手动卡进入待确认列表', () => {
    const updated = addRecognizedCard(result({ cards: [] }), { region: 'mainTroops', selectedKind: 'troop', selectedId: 2 })
    const added = updated.cards[0]
    expect(added.confirmed).toBe(false)
    expect(added.issueKind).toBe('missing-count')
    expect(buildRecognitionReview(updated).unresolvedKeys).toContain(added.key)
  })

  it('手动卡键不与识别卡冲突', () => {
    const first = addRecognizedCard(result({ cards: [] }), { region: 'mainTroops', selectedKind: 'troop', selectedId: 2, count: 1 })
    const second = addRecognizedCard(first, { region: 'mainTroops', selectedKind: 'troop', selectedId: 3, count: 1 })
    expect(second.cards).toHaveLength(2)
    expect(second.cards[1].key).not.toBe(second.cards[0].key)
    expect(second.cards.every((entry) => entry.manual)).toBe(true)
  })

  it('删除卡片后配兵同步移除', () => {
    const removed = removeRecognizedCard(result(), 'card-1')
    expect(removed.cards).toHaveLength(0)
    expect(buildRecognitionReview(removed).composition.troops).toEqual([])
  })

  it('删除不存在的键时结果不变', () => {
    const candidate = result()
    expect(removeRecognizedCard(candidate, 'missing-key').cards).toHaveLength(1)
  })
})
