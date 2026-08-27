import { describe, expect, it } from 'vitest'
import { cropImageData, locateGameViewport, projectRectFromViewport } from './viewportLocator'

const imageWithViewport = (width: number, height: number, viewport: { left: number, top: number, right: number, bottom: number }) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = viewport.top; y < viewport.bottom; y += 1) for (let x = viewport.left; x < viewport.right; x += 1) {
    const offset = (y * width + x) * 4
    data.set([92, 126, 164, 255], offset)
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData
}

describe('游戏画面定位', () => {
  it('裁掉与图片四边连通的纯黑视频边框', () => {
    const image = imageWithViewport(600, 500, { left: 50, top: 100, right: 550, bottom: 400 })
    const located = locateGameViewport(image)
    expect(located.cropped).toBe(true)
    expect(located.rect.x).toBeCloseTo(50 / 600, 3)
    expect(located.rect.y).toBeCloseTo(100 / 500, 3)
    expect(located.rect.width).toBeCloseTo(500 / 600, 3)
    expect(located.rect.height).toBeCloseTo(300 / 500, 3)
    expect(cropImageData(image, located.rect)).toMatchObject({ width: 500, height: 300 })
  })

  it('没有可靠黑边时保留完整画面', () => {
    const image = imageWithViewport(500, 300, { left: 0, top: 0, right: 500, bottom: 300 })
    expect(locateGameViewport(image)).toMatchObject({ rect: { x: 0, y: 0, width: 1, height: 1 }, cropped: false })
  })

  it('把游戏画面内面板坐标映射回原始截图', () => {
    const projected = projectRectFromViewport(
      { x: .1, y: .2, width: .8, height: .6 },
      { x: .1, y: .25, width: .8, height: .5 },
    )
    expect(projected.x).toBeCloseTo(.18)
    expect(projected.y).toBeCloseTo(.35)
    expect(projected.width).toBeCloseTo(.64)
    expect(projected.height).toBeCloseTo(.3)
  })
})
