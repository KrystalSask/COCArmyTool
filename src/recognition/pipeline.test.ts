import { describe, expect, it } from 'vitest'
import { allItems } from '../data/gameData'
import { createArmyLink, normalizeComposition, parseArmyLink } from '../domain/armyLink'
import { validateComposition } from '../domain/validation'
import { computeDifferenceHash, getIconCandidates, hammingDistance, iconFeatureManifest } from './iconIndex'
import { detectCardSlots } from './cardDetector'
import { createMockRecognitionResult } from './mockEngine'
import { inspectDimensions } from './preflight'
import { buildRecognitionReview, canConfirmAllCandidates, confirmAllCandidates, confirmAllMockCandidates, heroEquipmentKey, heroPetKey, updateRecognizedCard, updateRecognizedHeroEquipment, updateRecognizedHeroPet } from './review'
import { createVisualRecognitionResult } from './visualEngine'
import type { AnalyzedHeroColumn } from './heroSubcardAnalysis'
import type { ScreenshotPreflight, ScreenshotRecognitionResult } from './types'

const preflight: ScreenshotPreflight = {
  fileName: '001.png', mimeType: 'image/png', width: 2048, height: 1024, aspectRatio: 2,
  sha256: 'test', layout: 'saved', layoutConfidence: .95, woodPixelRatio: .6, complete: true, issues: [],
  panel: { x: 194 / 2622, y: 36 / 1206, width: 2169 / 2622, height: 1103 / 1206 }, panelConfidence: .95, panelSource: 'automatic',
}

describe('截图识别样本前置管线', () => {
  it('拒绝低分辨率或不支持格式，但允许先从竖屏外壳提取横屏游戏画面', () => {
    expect(inspectDimensions(2048, 1024, 'image/png').complete).toBe(true)
    expect(inspectDimensions(800, 1200, 'image/gif').issues).toHaveLength(2)
    expect(inspectDimensions(1440, 3200, 'image/png').complete).toBe(true)
  })

  it('图标索引覆盖全部136项并按区域缩小候选范围', () => {
    expect(iconFeatureManifest).toHaveLength(allItems.length)
    expect(iconFeatureManifest).toHaveLength(136)
    expect(getIconCandidates('mainSpells')).toHaveLength(18)
    expect(getIconCandidates('mainSiege')).toHaveLength(9)
  })

  it('dHash与汉明距离接口可稳定比较', () => {
    const ascending = Array.from({ length: 72 }, (_, index) => index)
    const descending = [...ascending].reverse()
    const first = computeDifferenceHash(ascending)
    const second = computeDifferenceHash(descending)
    expect(hammingDistance(first, first)).toBe(0)
    expect(hammingDistance(first, second)).toBe(64)
  })

  it('使用清晰数量锚点校准卡片间距', () => {
    const width = 2160
    const height = 120
    const data = new Uint8ClampedArray(width * height * 4)
    const paint = (x: number, y: number, w: number, h: number) => {
      for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) {
        const offset = (py * width + px) * 4
        data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255
      }
    }
    for (const start of [10, 120, 230]) {
      paint(start + 9, 8, 17, 18)
      paint(start + 30, 8, 8, 20)
    }
    const cards = detectCardSlots({ width, height, data }, { x: 0, y: 0, width: 360 / width, height: 1 })
    expect(cards).toHaveLength(3)
    expect(cards[1].rect.x).toBeCloseTo(120 / width, 1)
  })

  it('数量文字缺失时使用等间距垂直卡片边缘切分', () => {
    const width = 600
    const height = 120
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 115; data[index + 1] = 72; data[index + 2] = 45; data[index + 3] = 255
    }
    for (const left of [20, 130, 240, 350]) for (let y = 5; y < 115; y += 1) for (let x = left; x < left + 100; x += 1) {
      const offset = (y * width + x) * 4
      const border = x - left < 4 || left + 100 - x <= 4
      data[offset] = border ? 45 : 35
      data[offset + 1] = border ? 175 : 85
      data[offset + 2] = border ? 235 : 145
      data[offset + 3] = 255
    }
    const cards = detectCardSlots({ width, height, data }, { x: 0, y: 0, width: 480 / width, height: 1 })
    expect(cards).toHaveLength(4)
  })

  it('中间数量标记缺失时按典型间距补回多个卡片槽', () => {
    const width = 700
    const height = 120
    const data = new Uint8ClampedArray(width * height * 4)
    const paint = (x: number, y: number, w: number, h: number) => {
      for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) {
        const offset = (py * width + px) * 4
        data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255
      }
    }
    for (const start of [10, 120, 450, 560]) {
      paint(start + 3, 4, 6, 7)
      paint(start + 12, 4, 3, 7)
    }
    const cards = detectCardSlots({ width, height, data }, { x: 0, y: 0, width: 1, height: 1 })
    expect(cards).toHaveLength(6)
  })

  it('类别已识别但数量缺失时仍保留卡片供人工填写', () => {
    const result = createVisualRecognitionResult(preflight, {
      regions: [{
        region: 'mainTroops', label: '主军队', validation: { issues: [], suggestions: [] }, slots: [{
          rect: { x: .4, y: .2, width: .08, height: .12 }, badgeConfidence: .62,
          candidates: [{ id: 8, kind: 'troop', score: .9 }],
          count: { confidence: 0, digits: [] },
        }],
      }],
      heroes: [],
    })
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].selectedId).toBe(8)
    expect(result.cards[0].count).toBeUndefined()
    expect(result.cards[0].issue).toContain('数量未能自动识别')
    expect(buildRecognitionReview(result).composition.troops).toEqual([])
  })

  it('模拟识别在未确认时禁止导出，确认后通过现有校验与链接回环', () => {
    const result = createMockRecognitionResult(preflight)
    expect(buildRecognitionReview(result).unresolvedKeys.length).toBeGreaterThan(0)
    const review = buildRecognitionReview(confirmAllMockCandidates(result))
    expect(review.unresolvedKeys).toEqual([])
    expect(validateComposition(review.composition).valid).toBe(true)
    expect(normalizeComposition(parseArmyLink(createArmyLink(review.composition)))).toEqual(normalizeComposition(review.composition))
  })
})

describe('英雄证据保留与未解决原因', () => {
  const rect = (x: number) => ({ x, y: .8, width: .05, height: .09 })
  // 列 0 完整（装备 52/60 同属 hero 7，战宠识别）；列 1 战宠低分未识别；
  // 列 2 装备归属冲突（0 属 hero 0、52 属 hero 7）；列 3 一件装备未识别。
  const heroColumns: AnalyzedHeroColumn[] = [
    {
      index: 0, heroId: 7, geometryScore: .82, diagnostics: [],
      equipment: [{ rect: rect(.01), candidates: [{ id: 52, score: .92 }] }, { rect: rect(.07), candidates: [{ id: 60, score: .90 }] }],
      pet: { rect: { x: .01, y: .72, width: .13, height: .07 }, candidates: [{ id: 16, score: .71 }], recognizedId: 16 },
    },
    {
      index: 1, heroId: 0, geometryScore: .81, diagnostics: [],
      equipment: [{ rect: rect(.01), candidates: [{ id: 0, score: .88 }] }, { rect: rect(.07), candidates: [{ id: 32, score: .87 }] }],
      pet: { rect: { x: .01, y: .72, width: .13, height: .07 }, candidates: [{ id: 9, score: .60 }, { id: 17, score: .59 }] },
    },
    {
      index: 2, geometryScore: .80, diagnostics: ['equipment-owner-conflict'],
      equipment: [{ rect: rect(.01), candidates: [{ id: 0, score: .85 }] }, { rect: rect(.07), candidates: [{ id: 52, score: .84 }] }],
      pet: { rect: { x: .01, y: .72, width: .13, height: .07 }, candidates: [{ id: 17, score: .69 }], recognizedId: 17 },
    },
    {
      index: 3, geometryScore: .79, diagnostics: [],
      equipment: [{ rect: rect(.01), candidates: [{ id: 4, score: .83 }] }, { rect: rect(.07), candidates: [] }],
      pet: { rect: { x: .01, y: .72, width: .13, height: .07 }, candidates: [{ id: 9, score: .70 }], recognizedId: 9 },
    },
  ]

  const incompleteResult = () => createVisualRecognitionResult(preflight, {
    regions: [{
      region: 'mainTroops', label: '主军队', validation: { issues: [], suggestions: [] }, slots: [{
        rect: { x: .4, y: .2, width: .08, height: .12 }, badgeConfidence: .62,
        candidates: [{ id: 8, kind: 'troop', score: .9 }],
        count: { confidence: 0, digits: [] },
      }],
    }],
    heroes: heroColumns,
  })

  it('四列英雄全部保留为审查证据，即使装备、战宠或归属不完整', () => {
    const result = incompleteResult()
    expect(result.heroes).toHaveLength(4)
    expect(result.heroes.map((hero) => hero.issueKind)).toEqual([
      'unconfirmed', 'low-confidence-pet', 'equipment-conflict', 'incomplete-equipment',
    ])
    expect(result.heroes[1].pet?.selectedId).toBeUndefined()
    expect(result.heroes[1].pet?.candidates).toHaveLength(2)
    expect(result.heroes[3].loadout.equipmentIds[1]).toBeUndefined()
  })

  it('不完整的英雄列不进入最终配兵，完整但未确认的列照常保留', () => {
    const review = buildRecognitionReview(incompleteResult())
    expect(review.composition.heroes).toHaveLength(1)
    expect(review.composition.heroes[0]).toEqual({ heroId: 7, petId: 16, equipmentIds: [52, 60] })
    expect(review.unresolvedKeys).toEqual(expect.arrayContaining(['hero-1', 'hero-2', 'hero-3']))
  })

  it('修改装备后重新推断英雄归属，冲突与不完整证据保持未解决', () => {
    const conflicted = updateRecognizedHeroEquipment(incompleteResult(), 'hero-1', 1, 4)
    expect(conflicted.heroes[1].loadout.equipmentIds).toEqual([0, 4])
    expect(conflicted.heroes[1].inference).toBe('conflict')
    expect(conflicted.heroes[1].issueKind).toBe('equipment-conflict')
    const withPet = updateRecognizedHeroPet(conflicted, 'hero-1', 9)
    expect(withPet.heroes[1].loadout.petId).toBe(9)
    expect(withPet.heroes[1].issueKind).toBe('equipment-conflict')
    const restored = updateRecognizedHeroEquipment(withPet, 'hero-1', 1, 32)
    expect(restored.heroes[1].loadout.heroId).toBe(0)
    expect(restored.heroes[1].issueKind).toBe('unconfirmed')
  })

  it('填写缺失数量后 issue 与 issueKind 一并清除并从未解决列表移除', () => {
    const result = incompleteResult()
    expect(result.cards[0].count).toBeUndefined()
    expect(result.cards[0].issueKind).toBe('missing-count')
    expect(buildRecognitionReview(result).unresolvedKeys).toContain('mainTroops-0')
    const fixed = updateRecognizedCard(result, 'mainTroops-0', { count: 5, confirmed: true, issue: undefined, issueKind: undefined })
    expect(fixed.cards[0].issue).toBeUndefined()
    expect(fixed.cards[0].issueKind).toBeUndefined()
    expect(buildRecognitionReview(fixed).unresolvedKeys).not.toContain('mainTroops-0')
    expect(buildRecognitionReview(fixed).composition.troops).toEqual([{ id: 8, count: 5 }])
  })

  it('批量确认只确认证据完整的项目，不完整英雄列保持未解决', () => {
    const confirmed = confirmAllCandidates(incompleteResult())
    expect(confirmed.heroes[0].confirmed).toBe(true)
    expect(confirmed.heroes[0].issueKind).toBeUndefined()
    expect(confirmed.heroes[1].confirmed).toBe(false)
    expect(confirmed.heroes[2].confirmed).toBe(false)
    expect(confirmed.heroes[3].confirmed).toBe(false)
    expect(buildRecognitionReview(confirmed).unresolvedKeys).toEqual(expect.arrayContaining(['hero-1', 'hero-2', 'hero-3']))
  })

  it('英雄装备与战宠子证据使用稳定键支持双向定位', () => {
    expect(heroEquipmentKey('hero-0', 0)).toBe('hero-0-equipment-0')
    expect(heroEquipmentKey('hero-0', 1)).toBe('hero-0-equipment-1')
    expect(heroPetKey('hero-0')).toBe('hero-0-pet')
    const result = incompleteResult()
    expect(result.heroes[0].equipment?.map((_item, index) => `${result.heroes[0].key}-equipment-${index}`)).toEqual(['hero-0-equipment-0', 'hero-0-equipment-1'])
    expect(`${result.heroes[0].key}-pet`).toBe(heroPetKey('hero-0'))
  })

  it('识别层直接标记重复英雄或战宠，批量确认不能绕过唯一性', () => {
    const result = incompleteResult()
    const duplicated: ScreenshotRecognitionResult = {
      ...result,
      heroes: result.heroes.map((hero, index) => index === 1
        ? { ...hero, loadout: { ...hero.loadout, heroId: 7, petId: 16, equipmentIds: [52, 57] } }
        : hero),
    }
    const review = buildRecognitionReview(duplicated)
    expect(review.result.heroes[0].issueKind).toBe('duplicate-hero')
    expect(review.result.heroes[1].issueKind).toBe('duplicate-hero')
    expect(review.unresolvedKeys).toEqual(expect.arrayContaining(['hero-0', 'hero-1']))
    expect(canConfirmAllCandidates(duplicated)).toBe(false)
    expect(review.composition.heroes).toHaveLength(1)
  })
})
