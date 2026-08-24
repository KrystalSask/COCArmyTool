import { describe, expect, it } from 'vitest'
import { allItems } from '../data/gameData'
import { createArmyLink, normalizeComposition, parseArmyLink } from '../domain/armyLink'
import { validateComposition } from '../domain/validation'
import { computeDifferenceHash, getIconCandidates, hammingDistance, iconFeatureManifest } from './iconIndex'
import { detectCardSlots } from './cardDetector'
import { createMockRecognitionResult } from './mockEngine'
import { inspectDimensions } from './preflight'
import { selectPanelProfile } from './panelLocator'
import { buildRecognitionReview, confirmAllMockCandidates } from './review'
import type { ScreenshotPreflight } from './types'

const preflight: ScreenshotPreflight = {
  fileName: '001.png', mimeType: 'image/png', width: 2048, height: 1024, aspectRatio: 2,
  sha256: 'test', layout: 'saved', layoutConfidence: .95, woodPixelRatio: .6, complete: true, issues: [],
  deviceProfile: 'iphone-17', panel: { x: 194 / 2622, y: 36 / 1206, width: 2169 / 2622, height: 1103 / 1206 }, panelConfidence: .95, panelSource: 'profile',
}

describe('截图识别样本前置管线', () => {
  it('拒绝低分辨率、竖屏或不支持格式', () => {
    expect(inspectDimensions(2048, 1024, 'image/png').complete).toBe(true)
    expect(inspectDimensions(800, 1200, 'image/gif').issues).toHaveLength(3)
  })

  it('区分 iPhone 与 iPad 面板画像', () => {
    expect(selectPanelProfile(2622, 1206).deviceProfile).toBe('iphone-17')
    const ipad = selectPanelProfile(2420, 1668)
    expect(ipad.deviceProfile).toBe('ipad-pro-2024-11')
    expect(ipad.panel.height).toBeLessThan(.7)
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

  it('以卡片左上角 x数量 标记分割卡片', () => {
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

  it('模拟识别在未确认时禁止导出，确认后通过现有校验与链接回环', () => {
    const result = createMockRecognitionResult(preflight)
    expect(buildRecognitionReview(result).unresolvedKeys.length).toBeGreaterThan(0)
    const review = buildRecognitionReview(confirmAllMockCandidates(result))
    expect(review.unresolvedKeys).toEqual([])
    expect(validateComposition(review.composition).valid).toBe(true)
    expect(normalizeComposition(parseArmyLink(createArmyLink(review.composition)))).toEqual(normalizeComposition(review.composition))
  })
})
