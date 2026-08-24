import { describe, expect, it } from 'vitest'
import { locatePanelFromPixels } from './panelLocator'

const imageWithPanel = () => {
  const width = 500
  const height = 330
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) data[index + 3] = 255
  const fill = (left: number, top: number, right: number, bottom: number, color: number[]) => {
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4
      data.set(color, offset)
    }
  }
  fill(45, 70, 455, 283, [130, 82, 55, 255])
  fill(425, 72, 449, 97, [235, 35, 30, 255])
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('全图军队面板定位', () => {
  it('通过关闭按钮和木纹主体定位带黑边画布中的面板', () => {
    const located = locatePanelFromPixels(imageWithPanel(), {
      deviceProfile: 'generic-landscape', panel: { x: .05, y: .03, width: .83, height: .915 }, confidence: .45,
    })
    expect(located.source).toBe('automatic')
    expect(located.panel.x).toBeCloseTo(.09, 1)
    expect(located.panel.y).toBeCloseTo(.21, 1)
    expect(located.panel.width).toBeCloseTo(.82, 1)
  })
})
