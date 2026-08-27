import { describe, expect, it } from 'vitest'
import { locatePanelCandidatesFromPixels, locatePanelFromPixels, refinePanelFromPixels, snapManualPanelEdge } from './panelLocator'

const paint = (image: ImageData, left: number, top: number, right: number, bottom: number, color: number[]) => {
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    image.data.set(color, (y * image.width + x) * 4)
  }
}

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
  fill(432, 75, 446, 89, [235, 35, 30, 255])
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('全图军队面板定位', () => {
  it('通过关闭按钮和木纹主体定位带黑边画布中的面板', () => {
    const located = locatePanelFromPixels(imageWithPanel(), {
      panel: { x: .05, y: .03, width: .83, height: .915 }, confidence: .45,
    })
    expect(located.source).toBe('automatic')
    expect(located.panel.x).toBeCloseTo(.09, 1)
    expect(located.panel.y).toBeCloseTo(.21, 1)
    expect(located.panel.width).toBeCloseTo(.82, 1)
  })

  it('在宽范围内用真实四边纠正按比例估算的粗框', () => {
    const refined = refinePanelFromPixels(imageWithPanel(), {
      panel: { x: .02, y: .18, width: .94, height: .75 },
      confidence: .6,
      source: 'automatic',
    }, .1)
    expect(refined.panel.x).toBeCloseTo(45 / 500, 2)
    expect(refined.panel.y).toBeCloseTo(70 / 330, 2)
    expect(refined.panel.width).toBeCloseTo(410 / 500, 2)
    expect(refined.panel.height).toBeCloseTo(213 / 330, 2)
    expect(refined.source).toBe('automatic')
  })

  it('面板比例轻微拉伸时保留真实四边而不强制改回固定比例', () => {
    const image = imageWithPanel()
    const refined = refinePanelFromPixels(image, {
      panel: { x: .075, y: 66 / 330, width: .85, height: 225 / 330 },
      confidence: .7,
      source: 'automatic',
    }, .1)
    expect(refined.panel.x).toBeCloseTo(45 / 500, 2)
    expect(refined.panel.width).toBeCloseTo(410 / 500, 2)
  })

  it('关闭按钮被白色 X 分割后仍合并红色碎片定位', () => {
    const image = imageWithPanel()
    paint(image, 438, 75, 440, 89, [245, 245, 245, 255])
    const located = locatePanelFromPixels(image)
    expect(located.source).toBe('automatic')
    expect(located.panel.x).toBeCloseTo(45 / 500, 1)
    expect(located.panel.y).toBeCloseTo(70 / 330, 1)
  })

  it('关闭按钮不在画面最右侧时使用全局结构回退定位', () => {
    const image = imageWithPanel()
    paint(image, 405, 0, 500, 330, [0, 0, 0, 255])
    paint(image, 382, 75, 396, 89, [235, 35, 30, 255])
    const located = locatePanelFromPixels(image)
    expect(located.source).toBe('automatic')
    expect(located.confidence).toBeGreaterThan(.4)
    expect(located.panel.x).toBeLessThanOrEqual(45 / 500)
    expect(located.panel.x + located.panel.width).toBeGreaterThan(382 / 500)
    expect(located.panel.width).toBeGreaterThan(.70)
  })

  it('忽略已有黄色调试框而不把它当作真实面板边缘', () => {
    const image = imageWithPanel()
    paint(image, 25, 60, 27, 300, [245, 210, 55, 255])
    paint(image, 25, 60, 470, 62, [245, 210, 55, 255])
    const refined = refinePanelFromPixels(image, {
      panel: { x: .09, y: .20, width: .82, height: .65 },
      confidence: .8,
      source: 'automatic',
    }, .1, .1)
    expect(refined.panel.x).toBeCloseTo(45 / 500, 2)
    expect(refined.panel.y).toBeCloseTo(70 / 330, 2)
  })

  it('为内部配准保留三到五个去重粗面板种子且不改变兼容定位结果', () => {
    const image = imageWithPanel()
    const located = refinePanelFromPixels(image, locatePanelFromPixels(image), .012, .035)
    const candidates = locatePanelCandidatesFromPixels(image)
    expect(candidates.length).toBeGreaterThanOrEqual(3)
    expect(candidates.length).toBeLessThanOrEqual(5)
    expect(candidates[0].panel).toEqual(located.panel)
    expect(new Set(candidates.map((candidate) => JSON.stringify(candidate.panel))).size).toBe(candidates.length)
  })
})

describe('手动面板边缘小范围吸附', () => {
  it('选择距离最近的合格连续边缘，即使更远位置存在对比度更强的边界', () => {
    const image = imageWithPanel()
    // 在真实面板左边缘（x=45）左侧画一条对比度更强的连续白色条带边缘，
    // 用户把左边缘拖到 x=50；距离优先应吸附回真实边缘而不是白色条带。
    paint(image, 38, 70, 44, 283, [255, 255, 255, 255])
    const snapped = snapManualPanelEdge(image, { x: 50 / 500, y: 70 / 330, width: 405 / 500, height: 213 / 330 }, 'left')
    expect(snapped).toBeDefined()
    expect(snapped!.x).toBeCloseTo(45 / 500, 3)
    expect(snapped!.width).toBeCloseTo(410 / 500, 3)
  })

  it('释放位置附近没有合格连续边缘时保持用户释放的坐标', () => {
    const image = imageWithPanel()
    const snapped = snapManualPanelEdge(image, { x: 25 / 500, y: 70 / 330, width: 430 / 500, height: 213 / 330 }, 'left')
    expect(snapped).toBeUndefined()
  })

  it('拒绝只覆盖局部跨度的短图标边缘并吸附到最近真实面板边', () => {
    const image = imageWithPanel()
    // x=34 是只有几十像素高的局部高对比度图标条，比真实面板边缘带更近但
    // 不连续；最近的真实面板边缘带在 x=44/45。
    paint(image, 34, 100, 35, 140, [255, 255, 255, 255])
    const snapped = snapManualPanelEdge(image, { x: 36 / 500, y: 70 / 330, width: 419 / 500, height: 213 / 330 }, 'left')
    expect(snapped!.x).toBeCloseTo(44 / 500, 3)
    expect(snapped!.width).toBeCloseTo(411 / 500, 3)
  })

  it('水平边同样吸附且只调整被拖动的边', () => {
    const image = imageWithPanel()
    const snapped = snapManualPanelEdge(image, { x: 45 / 500, y: 76 / 330, width: 410 / 500, height: 207 / 330 }, 'top')
    expect(snapped!.y).toBeCloseTo(70 / 330, 3)
    expect(snapped!.height).toBeCloseTo(213 / 330, 3)
    expect(snapped!.x).toBeCloseTo(45 / 500, 3)
    expect(snapped!.width).toBeCloseTo(410 / 500, 3)
  })

  it('提交的手动面板作为唯一候选锁定，不再经过边缘精化或偏移变体', () => {
    const image = imageWithPanel()
    const manual = { x: .09, y: .21, width: .82, height: .65 }
    const candidates = locatePanelCandidatesFromPixels(image, undefined, manual)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe('manual')
    expect(candidates[0].source).toBe('manual')
    expect(candidates[0].panel).toEqual(manual)
    expect(candidates[0].geometryScore).toBe(1)
  })
})
