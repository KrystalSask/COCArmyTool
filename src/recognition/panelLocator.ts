import type { NormalizedRect } from './types'
import type { CoarsePanelCandidate } from './panelRegistration'

export interface LocatedPanel {
  panel: NormalizedRect
  confidence: number
  source?: 'automatic' | 'fallback' | 'manual'
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const createPanelFallback = (): LocatedPanel => ({
  panel: { x: .02, y: .02, width: .96, height: .96 },
  confidence: .2,
  source: 'fallback',
})

interface Component { left: number, top: number, right: number, bottom: number, area: number }

const isCloseRed = (data: Uint8ClampedArray, offset: number) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  return red > 145 && red > green * 1.55 && red > blue * 1.35 && green < 125
}

const isControlGreen = (data: Uint8ClampedArray, offset: number) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  return green > 105 && green > red * 1.12 && green > blue * 1.15
}

const colorComponents = (
  image: ImageData,
  predicate: (data: Uint8ClampedArray, offset: number) => boolean,
  minArea = 20,
  minSize = 5,
) => {
  const { width, height, data } = image
  const mask = new Uint8Array(width * height)
  const visited = new Uint8Array(mask.length)
  for (let index = 0; index < mask.length; index += 1) mask[index] = Number(predicate(data, index * 4))
  const queue = new Int32Array(mask.length)
  const result: Component[] = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    let head = 0
    let tail = 1
    queue[0] = start
    visited[start] = 1
    let left = start % width
    let right = left
    let top = Math.floor(start / width)
    let bottom = top
    let area = 0
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      area += 1
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue
        const nextX = next % width
        if (Math.abs(nextX - x) > 1) continue
        visited[next] = 1
        queue[tail++] = next
      }
    }
    const componentWidth = right - left + 1
    const componentHeight = bottom - top + 1
    if (area >= minArea && componentWidth >= minSize && componentHeight >= minSize) result.push({ left, top, right, bottom, area })
  }
  return result
}

// The white X and black outline can split the red close-button background into
// several disconnected islands after a screenshot is reduced to 512 px. Merge
// nearby red islands before using their bounding box as a scale anchor.
const mergeNearbyRedComponents = (components: Component[], image: ImageData) => components.map((seed) => {
  let merged = { ...seed }
  let changed = true
  const included = new Set<Component>([seed])
  while (changed) {
    changed = false
    for (const component of components) {
      if (included.has(component)) continue
      const horizontalGap = Math.max(0, Math.max(component.left, merged.left) - Math.min(component.right, merged.right) - 1)
      const verticalGap = Math.max(0, Math.max(component.top, merged.top) - Math.min(component.bottom, merged.bottom) - 1)
      const closeEnough = horizontalGap <= Math.max(3, image.width * .014)
        && verticalGap <= Math.max(2, image.height * .012)
      const unionWidth = Math.max(component.right, merged.right) - Math.min(component.left, merged.left) + 1
      const unionHeight = Math.max(component.bottom, merged.bottom) - Math.min(component.top, merged.top) + 1
      if (!closeEnough || unionWidth > image.width * .09 || unionHeight > image.height * .12) continue
      included.add(component)
      merged = {
        left: Math.min(merged.left, component.left), top: Math.min(merged.top, component.top),
        right: Math.max(merged.right, component.right), bottom: Math.max(merged.bottom, component.bottom),
        area: merged.area + component.area,
      }
      changed = true
    }
  }
  return merged
}).filter((component, index, all) => all.findIndex((other) =>
  other.left === component.left && other.top === component.top
  && other.right === component.right && other.bottom === component.bottom,
) === index)

const sampleRatio = (image: ImageData, rect: NormalizedRect, predicate: (offset: number) => boolean, stride = 3) => {
  const left = clamp(Math.round(rect.x * image.width), 0, image.width - 1)
  const top = clamp(Math.round(rect.y * image.height), 0, image.height - 1)
  const right = clamp(Math.round((rect.x + rect.width) * image.width), left + 1, image.width)
  const bottom = clamp(Math.round((rect.y + rect.height) * image.height), top + 1, image.height)
  let matched = 0
  let total = 0
  for (let y = top; y < bottom; y += stride) for (let x = left; x < right; x += stride) {
    total += 1
    if (predicate((y * image.width + x) * 4)) matched += 1
  }
  return total ? matched / total : 0
}

const panelCandidateScore = (image: ImageData, panel: NormalizedRect) => {
  const { data } = image
  const wood = sampleRatio(image, {
    x: panel.x + panel.width * .05, y: panel.y + panel.height * .11,
    width: panel.width * .90, height: panel.height * .82,
  }, (offset) => {
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2]
    return red > 58 && red < 220 && red > green * 1.05 && green > blue * .92 && blue < 155
  }, 4)
  const closeRed = sampleRatio(image, {
    x: panel.x + panel.width * .925, y: panel.y,
    width: panel.width * .065, height: panel.height * .095,
  }, (offset) => isCloseRed(data, offset), 1)
  const greenControl = sampleRatio(image, {
    x: panel.x + panel.width * .008, y: panel.y + panel.height * .008,
    width: panel.width * .075, height: panel.height * .09,
  }, (offset) => {
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2]
    return green > 105 && green > red * 1.12 && green > blue * 1.15
  }, 1)
  const interior = wood * .50 + Math.min(1, closeRed * 5) * .28 + Math.min(1, greenControl * 2.5) * .22
  return { score: interior, wood, closeRed, greenControl }
}

const panelBoundaryContrast = (image: ImageData, panel: NormalizedRect) => {
  const { data, width, height } = image
  const sampleLuminance = (x: number, y: number) => {
    const boundedX = clamp(Math.round(x), 0, width - 1)
    const boundedY = clamp(Math.round(y), 0, height - 1)
    const offset = (boundedY * width + boundedX) * 4
    return data[offset] * .299 + data[offset + 1] * .587 + data[offset + 2] * .114
  }
  const left = panel.x * width
  const right = (panel.x + panel.width) * width
  const top = panel.y * height
  const bottom = (panel.y + panel.height) * height
  const insetX = Math.max(2, panel.width * width * .008)
  const insetY = Math.max(2, panel.height * height * .012)
  let contrast = 0
  let count = 0
  for (let ratio = .14; ratio <= .86; ratio += .08) {
    const y = top + (bottom - top) * ratio
    contrast += Math.abs(sampleLuminance(left - insetX, y) - sampleLuminance(left + insetX, y))
    contrast += Math.abs(sampleLuminance(right - insetX, y) - sampleLuminance(right + insetX, y))
    count += 2
  }
  for (let ratio = .10; ratio <= .90; ratio += .08) {
    const x = left + (right - left) * ratio
    contrast += Math.abs(sampleLuminance(x, top - insetY) - sampleLuminance(x, top + insetY))
    count += 1
  }
  return clamp(contrast / Math.max(1, count) / 80, 0, 1)
}

const locatePanelFromStructureFallback = (image: ImageData, fallback: LocatedPanel): LocatedPanel => {
  const components = mergeNearbyRedComponents(colorComponents(image, isCloseRed, 4, 2), image).filter((component) => {
    const componentWidth = component.right - component.left + 1
    const componentHeight = component.bottom - component.top + 1
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    return component.area >= 12 && centerX > .65 && centerY < .48
      && componentWidth < image.width * .10 && componentHeight < image.height * .14
      && componentWidth / componentHeight > .45 && componentWidth / componentHeight < 1.8
  }).slice(0, 12)
  let best: { panel: NormalizedRect, score: number, wood: number } | undefined
  const pixelAspect = image.width / image.height
  for (const component of components) {
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    for (let width = .64; width <= 1.10; width += .02) {
      for (const physicalAspect of [1.78, 1.86, 1.94, 2.02, 2.10]) {
        const height = width * pixelAspect / physicalAspect
        if (height < .42 || height > 1.12) continue
        for (const closeXRatio of [.934, .954, .974]) for (const closeYRatio of [.045, .055, .065]) {
          const panel = { x: centerX - width * closeXRatio, y: centerY - height * closeYRatio, width, height }
          if (panel.x < -.14 || panel.y < -.12 || panel.x + panel.width > 1.14 || panel.y + panel.height > 1.14) continue
          const evidence = panelCandidateScore(image, panel)
          const visibleWidth = Math.max(0, Math.min(1, panel.x + panel.width) - Math.max(0, panel.x))
          const visibleHeight = Math.max(0, Math.min(1, panel.y + panel.height) - Math.max(0, panel.y))
          const coverage = visibleWidth * visibleHeight / (panel.width * panel.height)
          const aspectPrior = Math.max(0, 1 - Math.abs(physicalAspect - 1.94) / .35)
          const boundary = panelBoundaryContrast(image, panel)
          const score = evidence.score * .62 + boundary * .16 + coverage * .12 + aspectPrior * .10
          if (!best || score > best.score) best = { panel, score, wood: evidence.wood }
        }
      }
    }
  }
  if (!best || best.wood < .18 || best.score < .30) return { ...fallback, source: 'fallback' }
  const left = clamp(best.panel.x, 0, 1)
  const top = clamp(best.panel.y, 0, 1)
  return {
    panel: {
      x: left,
      y: top,
      width: Math.min(best.panel.width, 1 - left),
      height: Math.min(best.panel.height, 1 - top),
    },
    confidence: clamp(.42 + (best.score - .30) * .9, .42, .78),
    source: 'automatic',
  }
}

// Locate the stable red close button first, then evaluate panel rectangles around it.
// This searches the whole image and is independent of device aspect ratio or video black bars.
export const locatePanelFromPixels = (image: ImageData, fallback: LocatedPanel = createPanelFallback()): LocatedPanel => {
  const redIslands = colorComponents(image, isCloseRed, 4, 2).filter((component) => {
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    return centerX > .60 && centerY < .40
  })
  const components = mergeNearbyRedComponents(redIslands, image).filter((component) => {
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    return component.area >= 20 && centerX > .60 && centerY < .35
      && width < image.width * .09 && height < image.height * .12 && width / height > .55 && width / height < 1.55
  }).sort((left, right) => {
    const leftX = (left.left + left.right + 1) / 2 / image.width
    const leftY = (left.top + left.bottom + 1) / 2 / image.height
    const rightX = (right.left + right.right + 1) / 2 / image.width
    const rightY = (right.top + right.bottom + 1) / 2 / image.height
    return right.area * (1 + rightX - rightY) - left.area * (1 + leftX - leftY)
  }).slice(0, 8)
  const greenComponents = colorComponents(image, isControlGreen).filter((component) => {
    const componentWidth = component.right - component.left + 1
    const componentHeight = component.bottom - component.top + 1
    return componentWidth < image.width * .16 && componentHeight < image.height * .16
      && component.left < image.width * .30 && component.top < image.height * .16
  })
  let best: { panel: NormalizedRect, score: number, wood: number } | undefined
  for (const component of components) {
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    const componentWidthRatio = (component.right - component.left + 1) / image.width
    const componentHeightRatio = (component.bottom - component.top + 1) / image.height
    // Use several nearby ratios rather than a single exact button measurement;
    // the white X and video compression can change the red fill by a pixel.
    for (const closeWidthRatio of [.029, .032, .0345, .037]) {
      const width = componentWidthRatio / closeWidthRatio
      if (width < .35 || width > 1.05) continue
      for (const closeHeightRatio of [.060, .064, .068]) {
        const height = componentHeightRatio / closeHeightRatio
        if (height < .35 || height > 1.05) continue
        for (const closeXRatio of [.968, .972, .976]) {
          for (const closeYRatio of [.05, .055, .06]) {
          const panel = { x: centerX - width * closeXRatio, y: centerY - height * closeYRatio, width, height }
          if (panel.x < -.04 || panel.y < -.04 || panel.x + panel.width > 1.04 || panel.y + panel.height > 1.04) continue
          if (panel.y > .40) continue
          const evidence = panelCandidateScore(image, panel)
          const componentFill = component.area / ((component.right - component.left + 1) * (component.bottom - component.top + 1))
          const closePrior = Math.max(0, 1 - Math.abs(closeXRatio - .972) / .04)
          const buttonWidthRatio = componentWidthRatio / width
          const buttonScalePrior = Math.max(0, 1 - Math.abs(buttonWidthRatio - .0345) / .004)
          const buttonHeightRatio = componentHeightRatio / height
          const buttonHeightPrior = Math.max(0, 1 - Math.abs(buttonHeightRatio - .064) / .008)
          const physicalAspect = panel.width * image.width / (panel.height * image.height)
          const aspectPrior = Math.max(0, 1 - Math.abs(physicalAspect - 1.78) / .48)
          const greenAnchorPrior = greenComponents.reduce((maximum, greenComponent) => {
            const greenCenterX = (greenComponent.left + greenComponent.right + 1) / 2 / image.width
            const greenCenterY = (greenComponent.top + greenComponent.bottom + 1) / 2 / image.height
            const relativeX = (greenCenterX - panel.x) / panel.width
            const relativeY = (greenCenterY - panel.y) / panel.height
            if (relativeX < -.02 || relativeX > .18 || relativeY < -.02 || relativeY > .16) return maximum
            const alignment = Math.max(0, 1 - Math.abs(relativeX - .077) / .04 - Math.abs(relativeY - .055) / .05)
            return Math.max(maximum, alignment)
          }, 0)
          const score = evidence.score * .35 + Math.min(1, componentFill * 2) * .05
            + closePrior * .05 + buttonScalePrior * .075 + buttonHeightPrior * .075
            + greenAnchorPrior * .15 + aspectPrior * .25
          if (!best || score > best.score) best = { panel, score, wood: evidence.wood }
          }
        }
      }
    }
  }
  if (!best || best.wood < .20 || best.score < .34) return locatePanelFromStructureFallback(image, fallback)
  const left = best.panel.x
  return {
    panel: {
      x: clamp(left, 0, 1), y: clamp(best.panel.y, 0, 1),
      width: Math.min(best.panel.width, 1 - Math.max(0, left)),
      height: Math.min(best.panel.height, 1 - Math.max(0, best.panel.y)),
    },
    confidence: clamp(.48 + (best.score - .34) * 1.5, .48, .97),
    source: 'automatic',
  }
}

const clampPanel = (panel: NormalizedRect): NormalizedRect => {
  const x = clamp(panel.x, 0, .99)
  const y = clamp(panel.y, 0, .99)
  return { x, y, width: clamp(panel.width, .1, 1 - x), height: clamp(panel.height, .1, 1 - y) }
}

export type ManualPanelEdge = 'left' | 'right' | 'top' | 'bottom'

const edgeLuminance = (pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  const boundedX = clamp(Math.round(x), 0, width - 1)
  const boundedY = clamp(Math.round(y), 0, height - 1)
  const offset = (boundedY * width + boundedX) * 4
  return pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114
}

// 一条真实面板边必须在整段评估跨度上持续出现对比度；局部图标、文字
// 或按钮边缘只覆盖一小段，其连续比例会被拒绝。
const verticalEdgeContinuity = (pixels: Uint8ClampedArray, width: number, height: number, x: number, yTop: number, yBottom: number) => {
  let strong = 0
  let total = 0
  let sum = 0
  for (let y = yTop; y <= yBottom; y += 2) {
    const contrast = Math.abs(edgeLuminance(pixels, width, height, x - 1, y) - edgeLuminance(pixels, width, height, x + 1, y))
    sum += contrast
    total += 1
    if (contrast >= 14) strong += 1
  }
  return total ? { strongRatio: strong / total, meanContrast: sum / total } : { strongRatio: 0, meanContrast: 0 }
}

const horizontalEdgeContinuity = (pixels: Uint8ClampedArray, width: number, height: number, y: number, xLeft: number, xRight: number) => {
  let strong = 0
  let total = 0
  let sum = 0
  for (let x = xLeft; x <= xRight; x += 2) {
    const contrast = Math.abs(edgeLuminance(pixels, width, height, x, y - 1) - edgeLuminance(pixels, width, height, x, y + 1))
    sum += contrast
    total += 1
    if (contrast >= 14) strong += 1
  }
  return total ? { strongRatio: strong / total, meanContrast: sum / total } : { strongRatio: 0, meanContrast: 0 }
}

// 手动拖拽的边在释放时做小范围吸附。手动位置是强先验：只接受释放
// 位置附近连续的真实边界，距离优先而不是最强边缘；没有任何合格边界
// 时保持用户释放的位置，绝不在宽范围内搜索。
export const snapManualPanelEdge = (pixels: ImageData, panel: NormalizedRect, edge: ManualPanelEdge): NormalizedRect | undefined => {
  const { width, height, data } = pixels
  const vertical = edge === 'left' || edge === 'right'
  const span = vertical ? panel.width * width : panel.height * height
  const radius = Math.max(4, Math.round(span * .035))
  const center = Math.round((edge === 'left' ? panel.x : edge === 'right' ? panel.x + panel.width : edge === 'top' ? panel.y : panel.y + panel.height)
    * (vertical ? width : height))
  const minimum = Math.max(1, center - radius)
  const maximum = Math.min((vertical ? width : height) - 2, center + radius)
  let best: { position: number, distance: number } | undefined
  for (let position = minimum; position <= maximum; position += 1) {
    const continuity = vertical
      ? verticalEdgeContinuity(data, width, height, position,
        clamp(Math.round((panel.y + panel.height * .26) * height), 1, height - 2),
        clamp(Math.round((panel.y + panel.height * .92) * height), 1, height - 2))
      : horizontalEdgeContinuity(data, width, height, position,
        clamp(Math.round((panel.x + panel.width * .12) * width), 1, width - 2),
        clamp(Math.round((panel.x + panel.width * .92) * width), 1, width - 2))
    if (continuity.strongRatio < .6 || continuity.meanContrast < 12) continue
    const distance = Math.abs(position - center)
    if (!best || distance < best.distance) best = { position, distance }
  }
  if (!best) return undefined
  const position = best.position / (vertical ? width : height)
  if (edge === 'left') return { x: position, y: panel.y, width: panel.x + panel.width - position, height: panel.height }
  if (edge === 'right') return { x: panel.x, y: panel.y, width: position - panel.x, height: panel.height }
  if (edge === 'top') return { x: panel.x, y: position, width: panel.width, height: panel.y + panel.height - position }
  return { x: panel.x, y: panel.y, width: panel.width, height: position - panel.y }
}

const closeButtonPanelSeeds = (image: ImageData): CoarsePanelCandidate[] => {
  const components = mergeNearbyRedComponents(colorComponents(image, isCloseRed, 4, 2), image).filter((component) => {
    const componentWidth = component.right - component.left + 1
    const componentHeight = component.bottom - component.top + 1
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    return component.area >= 12 && centerX > .55 && centerY < .42
      && componentWidth < image.width * .10 && componentHeight < image.height * .14
      && componentWidth / componentHeight > .42 && componentWidth / componentHeight < 1.9
  })
  const pixelAspect = image.width / image.height
  const seeds: CoarsePanelCandidate[] = []
  components.forEach((component, componentIndex) => {
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    const componentWidthRatio = (component.right - component.left + 1) / image.width
    const componentHeightRatio = (component.bottom - component.top + 1) / image.height
    let best: { panel: NormalizedRect, score: number } | undefined
    for (const closeWidthRatio of [.025, .029, .032, .0345, .037]) {
      const width = componentWidthRatio / closeWidthRatio
      if (width < .38 || width > 1.08) continue
      for (const closeHeightRatio of [.055, .06, .064, .068, .073]) {
        const height = componentHeightRatio / closeHeightRatio
        if (height < .38 || height > 1.08) continue
        for (const closeXRatio of [.936, .954, .972]) for (const closeYRatio of [.045, .055, .065]) {
          const panel = { x: centerX - width * closeXRatio, y: centerY - height * closeYRatio, width, height }
          if (panel.x < -.08 || panel.y < -.06 || panel.x + panel.width > 1.08 || panel.y + panel.height > 1.08) continue
          const evidence = panelCandidateScore(image, panel)
          const physicalAspect = width * pixelAspect / height
          const aspect = Math.max(0, 1 - Math.abs(physicalAspect - 1.92) / .42)
          const boundary = panelBoundaryContrast(image, panel)
          const score = evidence.score * .62 + aspect * .23 + boundary * .15
          if (!best || score > best.score) best = { panel: clampPanel(panel), score }
        }
      }
    }
    if (best) seeds.push({ id: `close-component-${componentIndex + 1}`, source: 'close-button', panel: best.panel, geometryScore: best.score })
  })
  return seeds.sort((left, right) => right.geometryScore - left.geometryScore).slice(0, 5)
}

const greenControlPanelSeeds = (image: ImageData): CoarsePanelCandidate[] => {
  const components = colorComponents(image, isControlGreen, 20, 4).filter((component) => {
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    return centerX < .38 && centerY < .28 && width < image.width * .16 && height < image.height * .16
  })
  const pixelAspect = image.width / image.height
  const seeds: CoarsePanelCandidate[] = []
  components.forEach((component, componentIndex) => {
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    const componentWidthRatio = (component.right - component.left + 1) / image.width
    const componentHeightRatio = (component.bottom - component.top + 1) / image.height
    let best: { panel: NormalizedRect, score: number } | undefined
    for (const controlWidthRatio of [.065, .075, .085]) for (const controlHeightRatio of [.06, .072, .084]) {
      const width = componentWidthRatio / controlWidthRatio
      const height = componentHeightRatio / controlHeightRatio
      if (width < .42 || width > 1.08 || height < .42 || height > 1.08) continue
      for (const controlXRatio of [.045, .055, .065]) for (const controlYRatio of [.045, .06, .075]) {
        const panel = { x: centerX - width * controlXRatio, y: centerY - height * controlYRatio, width, height }
        if (panel.x < -.08 || panel.y < -.06 || panel.x + panel.width > 1.08 || panel.y + panel.height > 1.08) continue
        const evidence = panelCandidateScore(image, panel)
        const physicalAspect = width * pixelAspect / height
        const aspect = Math.max(0, 1 - Math.abs(physicalAspect - 1.92) / .42)
        const boundary = panelBoundaryContrast(image, panel)
        const score = evidence.score * .62 + aspect * .23 + boundary * .15
        if (!best || score > best.score) best = { panel: clampPanel(panel), score }
      }
    }
    if (best) seeds.push({ id: `green-component-${componentIndex + 1}`, source: 'structure', panel: best.panel, geometryScore: best.score })
  })
  return seeds.sort((left, right) => right.geometryScore - left.geometryScore).slice(0, 4)
}

/** Generates a small, explainable set of seeds; final selection belongs to internal registration. */
export const locatePanelCandidatesFromPixels = (
  image: ImageData,
  fallback: LocatedPanel = createPanelFallback(),
  manualPanel?: NormalizedRect,
): CoarsePanelCandidate[] => {
  if (!manualPanel) {
    const located = locatePanelFromPixels(image, fallback)
    const legacy = refinePanelFromPixels(image, located, .012, .035)
    const closeSeeds = closeButtonPanelSeeds(image)
    const greenSeeds = greenControlPanelSeeds(image)
    const greenBottomHybrids: CoarsePanelCandidate[] = greenSeeds.slice(0, 2).map((seed, index) => ({
      id: `hybrid-green-bottom-${index + 1}`,
      source: 'structure',
      panel: clampPanel({ ...legacy.panel, height: seed.panel.y + seed.panel.height - legacy.panel.y }),
      geometryScore: (legacy.confidence + seed.geometryScore) / 2,
    }))
    const baseSeeds = [...greenBottomHybrids, ...greenSeeds.slice(0, 1), ...closeSeeds.slice(0, 1)]
    const refinedSeeds = [...closeSeeds, ...greenSeeds].sort((left, right) => right.geometryScore - left.geometryScore).slice(0, 4).map((seed) => {
      const refined = refinePanelFromPixels(image, { panel: seed.panel, confidence: seed.geometryScore, source: 'automatic' }, .018, .04)
      return { ...seed, id: `${seed.id}-edge-refined`, panel: refined.panel, geometryScore: refined.confidence }
    })
    const combined: CoarsePanelCandidate[] = [
      { id: 'legacy-locator', source: located.source === 'automatic' ? 'close-button' : located.source ?? 'fallback', panel: legacy.panel, geometryScore: legacy.confidence },
      ...baseSeeds,
      ...refinedSeeds,
    ]
    return combined.filter((candidate, index, all) => all.findIndex((other) =>
      Math.max(Math.abs(candidate.panel.x - other.panel.x), Math.abs(candidate.panel.y - other.panel.y), Math.abs(candidate.panel.width - other.panel.width), Math.abs(candidate.panel.height - other.panel.height)) < .003,
    ) === index).slice(0, 5)
  }
  // 提交的手动面板是用户强先验：不再经过 strongest-edge 精化，也不生成
  // 偏移变体，避免静默改写用户矩形。后续注册与卡片结构候选也一律跳过。
  if (manualPanel) {
    return [{ id: 'manual', source: 'manual' as const, panel: clampPanel(manualPanel), geometryScore: 1 }]
  }
  const located = locatePanelFromPixels(image, fallback)
  const refined = refinePanelFromPixels(image, located, .012, .035)
  const source: CoarsePanelCandidate['source'] = located.source === 'automatic' ? 'close-button' : located.source ?? 'fallback'
  const variants: Array<{ dx: number, dy: number, dw: number, dh: number }> = [
    { dx: 0, dy: 0, dw: 0, dh: 0 }, { dx: -.01, dy: 0, dw: .01, dh: 0 }, { dx: .01, dy: 0, dw: -.01, dh: 0 },
    { dx: 0, dy: -.01, dw: 0, dh: .01 }, { dx: 0, dy: .01, dw: 0, dh: -.01 },
  ]
  return variants.map((variant, index) => ({
    id: `${source}-${index + 1}`,
    source,
    geometryScore: Math.max(.05, refined.confidence - index * .025),
    panel: clampPanel({
      x: refined.panel.x + refined.panel.width * variant.dx,
      y: refined.panel.y + refined.panel.height * variant.dy,
      width: refined.panel.width * (1 + variant.dw),
      height: refined.panel.height * (1 + variant.dh),
    }),
  }))
}

const luminance = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const offset = (y * width + x) * 4
  return pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114
}

const isDebugOverlayPixel = (pixels: Uint8ClampedArray, offset: number) => {
  const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
  return (red > 180 && green > 145 && blue < 135)
    || (red < 145 && green > 155 && blue > 155)
}

const verticalScore = (pixels: Uint8ClampedArray, width: number, x: number, top: number, bottom: number) => {
  let score = 0
  let count = 0
  for (let y = top; y <= bottom; y += 2) {
    const leftOffset = (y * width + x - 1) * 4
    const rightOffset = (y * width + x + 1) * 4
    if (isDebugOverlayPixel(pixels, leftOffset) || isDebugOverlayPixel(pixels, rightOffset)) continue
    score += Math.abs(luminance(pixels, width, x - 1, y) - luminance(pixels, width, x + 1, y))
    count += 1
  }
  return count ? score / count : 0
}

const horizontalScore = (pixels: Uint8ClampedArray, width: number, y: number, left: number, right: number) => {
  let score = 0
  let count = 0
  for (let x = left; x <= right; x += 2) {
    const topOffset = ((y - 1) * width + x) * 4
    const bottomOffset = ((y + 1) * width + x) * 4
    if (isDebugOverlayPixel(pixels, topOffset) || isDebugOverlayPixel(pixels, bottomOffset)) continue
    score += Math.abs(luminance(pixels, width, x, y - 1) - luminance(pixels, width, x, y + 1))
    count += 1
  }
  return count ? score / count : 0
}

const isWoodPixel = (pixels: Uint8ClampedArray, offset: number) => {
  const red = pixels[offset]
  const green = pixels[offset + 1]
  const blue = pixels[offset + 2]
  return red > 58 && red < 220 && red > green * 1.05 && green > blue * .92 && blue < 155
}

const woodBandRatio = (pixels: Uint8ClampedArray, width: number, height: number, left: number, right: number, top: number, bottom: number) => {
  const x0 = clamp(Math.round(left), 0, width - 1)
  const x1 = clamp(Math.round(right), x0 + 1, width)
  const y0 = clamp(Math.round(top), 0, height - 1)
  const y1 = clamp(Math.round(bottom), y0 + 1, height)
  let wood = 0
  let total = 0
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    total += 1
    if (isWoodPixel(pixels, (y * width + x) * 4)) wood += 1
  }
  return total ? wood / total : 0
}

const luminanceBandMean = (pixels: Uint8ClampedArray, width: number, height: number, left: number, right: number, top: number, bottom: number) => {
  const x0 = clamp(Math.round(left), 0, width - 1)
  const x1 = clamp(Math.round(right), x0 + 1, width)
  const y0 = clamp(Math.round(top), 0, height - 1)
  const y1 = clamp(Math.round(bottom), y0 + 1, height)
  let sum = 0
  let total = 0
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 3) {
    sum += luminance(pixels, width, x, y)
    total += 1
  }
  return total ? sum / total : 0
}

const strongestLine = (expected: number, radius: number, min: number, max: number, score: (position: number) => number) => {
  let bestPosition = clamp(Math.round(expected), min, max)
  let bestScore = -1
  for (let position = clamp(Math.round(expected - radius), min, max); position <= clamp(Math.round(expected + radius), min, max); position += 1) {
    const current = score(position)
    if (current > bestScore) {
      bestScore = current
      bestPosition = position
    }
  }
  return { position: bestPosition, score: bestScore }
}

const extendRightThroughWood = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  right: number,
  top: number,
  bottom: number,
  radius: number,
) => {
  const columnRatio = (x: number) => woodBandRatio(pixels, width, height, x, x + 1, top, bottom)
  const references: number[] = []
  for (let x = clamp(Math.round(right - 12), 0, width - 1); x < right - 3; x += 2) references.push(columnRatio(x))
  references.sort((a, b) => a - b)
  const reference = references[Math.floor(references.length / 2)] ?? 0
  if (reference < .18) return right
  const threshold = Math.max(.16, reference * .55)
  const maximum = clamp(Math.round(right + radius), 0, width)
  let lastWood = right
  let gap = 0
  for (let x = clamp(Math.round(right), 0, width - 1); x < maximum; x += 1) {
    if (columnRatio(x) >= threshold) {
      lastWood = x + 1
      gap = 0
    } else if (++gap >= 3) {
      break
    }
  }
  return lastWood > right + 3 ? lastWood : right
}

export const refinePanelFromPixels = (imageData: ImageData, coarse: LocatedPanel, searchRadius = .012, verticalSearchRadius = searchRadius): LocatedPanel => {
  const { width, height, data } = imageData
  const left0 = coarse.panel.x * width
  const right0 = (coarse.panel.x + coarse.panel.width) * width
  const top0 = coarse.panel.y * height
  const bottom0 = (coarse.panel.y + coarse.panel.height) * height
  const touchesLeft = left0 <= 1
  const touchesTop = top0 <= 1
  const touchesRight = right0 >= width - 1
  const coarseWidth = Math.max(1, right0 - left0)
  const coarseHeight = Math.max(1, bottom0 - top0)
  // Scale inferred from the red fill can be a few percent short when the white
  // X splits it. Search farther only for the left and bottom edges; the right
  // and top remain tightly tied to the close-button anchor.
  const leftRadius = coarseWidth * Math.max(searchRadius, .07)
  const rightRadius = coarseWidth * searchRadius
  const topRadius = coarseHeight * verticalSearchRadius
  const bottomRadius = coarseHeight * Math.max(verticalSearchRadius, .12)
  const topBand = clamp(Math.round(top0 + coarseHeight * .03), 2, height - 3)
  const bottomBand = clamp(Math.round(bottom0 - coarseHeight * .03), 2, height - 3)
  const headerTop = top0 + coarseHeight * .11
  const headerBottom = top0 + coarseHeight * .24
  const left = touchesLeft ? { position: 0, score: 70 * coarse.confidence } : strongestLine(left0, leftRadius, 2, width - 3, (x) => {
    const edge = verticalScore(data, width, x, topBand, bottomBand)
    const outsideWood = woodBandRatio(data, width, height, x - coarseWidth * .025, x - coarseWidth * .007, headerTop, headerBottom)
    const insideWood = woodBandRatio(data, width, height, x + coarseWidth * .007, x + coarseWidth * .025, headerTop, headerBottom)
    return edge + Math.max(0, insideWood - outsideWood) * 240
  })
  const right = touchesRight ? { position: width, score: 70 * coarse.confidence } : strongestLine(right0, rightRadius, 2, width - 3, (x) => {
    const edge = verticalScore(data, width, x, topBand, bottomBand)
    const insideWood = woodBandRatio(data, width, height, x - coarseWidth * .025, x - coarseWidth * .007, headerTop, headerBottom)
    const outsideWood = woodBandRatio(data, width, height, x + coarseWidth * .007, x + coarseWidth * .025, headerTop, headerBottom)
    return edge + Math.max(0, insideWood - outsideWood) * 240
  })
  const refinedLeftBand = clamp(Math.round(left.position + coarseWidth * .02), 2, width - 3)
  const refinedRightBand = clamp(Math.round(right.position - coarseWidth * .02), 2, width - 3)
  const top = touchesTop ? { position: 0, score: 70 * coarse.confidence } : strongestLine(top0, topRadius, 2, height - 3, (y) => horizontalScore(data, width, y, refinedLeftBand, refinedRightBand))
  const bottom = strongestLine(bottom0, bottomRadius, 2, height - 3, (y) => {
    const edge = horizontalScore(data, width, y, refinedLeftBand, refinedRightBand)
    const insideWood = woodBandRatio(data, width, height, refinedLeftBand, refinedRightBand, y - coarseHeight * .025, y - coarseHeight * .007)
    const outsideWood = woodBandRatio(data, width, height, refinedLeftBand, refinedRightBand, y + coarseHeight * .007, y + coarseHeight * .025)
    const insideLuminance = luminanceBandMean(data, width, height, refinedLeftBand, refinedRightBand, y - coarseHeight * .025, y - coarseHeight * .007)
    const outsideLuminance = luminanceBandMean(data, width, height, refinedLeftBand, refinedRightBand, y + coarseHeight * .007, y + coarseHeight * .025)
    return edge + Math.max(0, insideWood - outsideWood) * 220 + Math.max(0, insideLuminance - outsideLuminance) * 3
  })
  // The selected gradient coordinate is already the exclusive crop boundary;
  // adding another 512px-analysis pixel becomes several source pixels later.
  const woodExtendedRight = touchesRight ? width : extendRightThroughWood(
    data, width, height, right.position,
    top.position + coarseHeight * .12, bottom.position - coarseHeight * .12,
    coarseWidth * .08,
  )
  const safeRight = Math.min(width, Math.max(right.position, woodExtendedRight))
  const safeBottom = Math.min(height, bottom.position)
  const refinedHeight = safeBottom - top.position
  const refinedWidth = safeRight - left.position
  const panelAspect = refinedHeight > 0 ? refinedWidth / refinedHeight : 0
  const valid = refinedWidth > coarseWidth * .55 && refinedHeight > coarseHeight * .55
    && panelAspect >= 1.55 && panelAspect <= 2.35
  if (!valid) return coarse
  const edgeScore = (left.score + right.score + top.score + bottom.score) / 4
  const stableHeight = coarse.confidence >= .8
    ? clamp(refinedHeight, coarseHeight * .946, coarseHeight * 1.012)
    : refinedHeight
  const expandToViewport = safeRight >= width - 1 && left.position / width < .08 && stableHeight / height > .85
  let stableLeft = expandToViewport ? 0 : left.position
  let stableRight = expandToViewport ? width : safeRight
  // Some game versions omit the third header tab. In that layout the close
  // button sits near 93.4% rather than 97.2% of the complete panel width. If
  // the ordinary edge result leaves the inferred close centre suspiciously
  // far inside the right edge, recover that alternate header geometry.
  const estimatedCloseX = (coarse.panel.x + coarse.panel.width * .972) * width
  const closePosition = (estimatedCloseX - stableLeft) / Math.max(1, stableRight - stableLeft)
  if (!expandToViewport && closePosition >= .93 && closePosition < .968) {
    stableLeft = Math.max(0, stableLeft - 1)
    stableRight = Math.min(width, stableLeft + (estimatedCloseX - stableLeft) / .936)
  }
  return {
    panel: {
      x: stableLeft / width,
      y: top.position / height,
      width: (stableRight - stableLeft) / width,
      height: stableHeight / height,
    },
    confidence: clamp(coarse.confidence * .65 + edgeScore / 70 * .35, .35, .99),
    source: coarse.source,
  }
}
