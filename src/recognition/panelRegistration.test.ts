import { describe, expect, it } from 'vitest'
import { registerPanelCandidates, scorePanelRegistration } from './panelRegistration'

const paint = (image: ImageData, left: number, top: number, right: number, bottom: number, color: number[]) => {
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) image.data.set(color, (y * image.width + x) * 4)
}

const structuredPanel = () => {
  const image = {
    width: 600,
    height: 360,
    data: new Uint8ClampedArray(600 * 360 * 4),
    colorSpace: 'srgb',
  } as ImageData
  paint(image, 60, 45, 540, 315, [125, 80, 52, 255])
  paint(image, 505, 47, 535, 74, [225, 35, 28, 255])
  for (const relativeY of [.205, .482, .742]) {
    const y = Math.round(45 + 270 * relativeY)
    paint(image, 252, y - 1, 533, y + 2, [50, 42, 37, 255])
  }
  for (const relativeX of [.015, .058, .092, .134, .151, .192, .221, .263, .279, .321, .350, .392, .421]) {
    const x = Math.round(60 + 480 * relativeX)
    paint(image, x - 1, 248, x + 2, 302, [45, 40, 38, 255])
  }
  return image
}

describe('面板内部锚点配准', () => {
  it('输出可解释的六类锚点证据并对候选排序', () => {
    const image = structuredPanel()
    const exact = { x: .1, y: .125, width: .8, height: .75 }
    const scored = scorePanelRegistration(image, exact)
    expect(scored.evidence.map((item) => item.kind)).toEqual(['close-button', 'wood', 'divider', 'hero-columns', 'equipment-row', 'panel-edge'])
    expect(scored.score).toBeGreaterThan(0)
    const registered = registerPanelCandidates(image, [
      { id: 'exact', source: 'structure', panel: exact, geometryScore: .7 },
      { id: 'shifted', source: 'structure', panel: { ...exact, x: .14 }, geometryScore: .5 },
    ])
    expect(registered.length).toBeGreaterThanOrEqual(2)
    expect(registered.length).toBeLessThanOrEqual(3)
    expect(registered[0].geometryScore).toBeGreaterThanOrEqual(registered[1].geometryScore)
  })
})
