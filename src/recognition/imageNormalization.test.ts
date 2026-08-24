import { describe, expect, it } from 'vitest'
import { MAX_INPUT_PIXELS, STANDARD_PANEL_HEIGHT, STANDARD_PANEL_WIDTH, pixelBounds } from './imageNormalization'

describe('标准识别空间', () => {
  it('将相对面板安全映射为源图像像素边界', () => {
    expect(pixelBounds({ x: .1, y: .2, width: .5, height: .6 }, 2000, 1000)).toEqual({ left: 200, top: 200, width: 1000, height: 600 })
    expect(pixelBounds({ x: -.1, y: -.1, width: 1.4, height: 1.4 }, 2000, 1000)).toEqual({ left: 0, top: 0, width: 2000, height: 1000 })
  })
  it('固定逻辑尺寸并限制超大输入', () => {
    expect([STANDARD_PANEL_WIDTH, STANDARD_PANEL_HEIGHT]).toEqual([2160, 1120])
    expect(MAX_INPUT_PIXELS).toBe(40_000_000)
  })
})
