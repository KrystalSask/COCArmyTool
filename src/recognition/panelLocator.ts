import type { NormalizedRect, ScreenshotDeviceProfile } from './types'

interface PanelProfile {
  id: Exclude<ScreenshotDeviceProfile, 'generic-landscape' | 'unknown'>
  aspectRatio: number
  panel: NormalizedRect
}

export interface LocatedPanel {
  deviceProfile: ScreenshotDeviceProfile
  panel: NormalizedRect
  confidence: number
  source?: 'automatic' | 'profile' | 'manual'
}

const profiles: PanelProfile[] = [
  { id: 'iphone-17', aspectRatio: 2622 / 1206, panel: { x: 194 / 2622, y: 36 / 1206, width: (2363 - 194) / 2622, height: (1139 - 36) / 1206 } },
  { id: 'ipad-pro-2024-11', aspectRatio: 2420 / 1668, panel: { x: 131 / 2420, y: 254 / 1668, width: (2292 - 131) / 2420, height: (1387 - 254) / 1668 } },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const selectPanelProfile = (width: number, height: number): LocatedPanel => {
  if (width <= 0 || height <= 0) return { deviceProfile: 'unknown', panel: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0 }
  const aspectRatio = width / height
  const nearest = profiles.map((profile) => ({ profile, difference: Math.abs(profile.aspectRatio - aspectRatio) }))
    .sort((a, b) => a.difference - b.difference)[0]
  if (nearest.difference <= .08) {
    return { deviceProfile: nearest.profile.id, panel: { ...nearest.profile.panel }, confidence: clamp(1 - nearest.difference / .08, .72, .98) }
  }
  return {
    deviceProfile: 'generic-landscape',
    panel: aspectRatio > 1.8
      ? { x: .07, y: .03, width: .83, height: .915 }
      : { x: .05, y: .15, width: .90, height: .69 },
    confidence: .45,
  }
}

interface Component { left: number, top: number, right: number, bottom: number, area: number }

const isCloseRed = (data: Uint8ClampedArray, offset: number) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  return red > 145 && red > green * 1.55 && red > blue * 1.35 && green < 125
}

const redComponents = (image: ImageData) => {
  const { width, height, data } = image
  const mask = new Uint8Array(width * height)
  const visited = new Uint8Array(mask.length)
  for (let index = 0; index < mask.length; index += 1) mask[index] = Number(isCloseRed(data, index * 4))
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
    if (area >= 20 && componentWidth >= 5 && componentHeight >= 5) result.push({ left, top, right, bottom, area })
  }
  return result
}

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
  const interior = wood * .68 + Math.min(1, closeRed * 5) * .32
  return { score: interior, wood, closeRed }
}

// Locate the stable red close button first, then evaluate panel rectangles around it.
// This searches the whole image and is independent of device aspect ratio or video black bars.
export const locatePanelFromPixels = (image: ImageData, fallback: LocatedPanel): LocatedPanel => {
  const components = redComponents(image).filter((component) => {
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    return width < image.width * .09 && height < image.height * .12 && width / height > .55 && width / height < 1.55
  })
  let best: { panel: NormalizedRect, score: number, wood: number } | undefined
  for (const component of components) {
    const centerX = (component.left + component.right + 1) / 2 / image.width
    const centerY = (component.top + component.bottom + 1) / 2 / image.height
    for (let width = .74; width <= .94; width += .01) {
      const pixelAspect = image.width / image.height
      for (const panelAspect of [1.88, 1.93, 1.98]) {
        const height = width * pixelAspect / panelAspect
        const panel = { x: centerX - width * .958, y: centerY - height * .05, width, height }
        if (panel.x < -.01 || panel.y < -.01 || panel.x + panel.width > 1.01 || panel.y + panel.height > 1.01) continue
        if (panel.y > .27) continue
        const evidence = panelCandidateScore(image, panel)
        const componentFill = component.area / ((component.right - component.left + 1) * (component.bottom - component.top + 1))
        const sizePrior = Math.max(0, 1 - Math.abs(width - .82) / .20)
        const topPrior = Math.max(0, 1 - Math.abs(panel.y - .12) / .28)
        const aspectPrior = Math.max(0, 1 - Math.abs(panelAspect - 1.93) / .12)
        const score = evidence.score * .58 + Math.min(1, componentFill * 2) * .08 + sizePrior * .18 + topPrior * .06 + aspectPrior * .10
        if (!best || score > best.score) best = { panel, score, wood: evidence.wood }
      }
    }
  }
  if (!best || best.wood < .20 || best.score < .34) return { ...fallback, source: 'profile' }
  return {
    deviceProfile: 'generic-landscape',
    panel: {
      x: clamp(best.panel.x, 0, 1), y: clamp(best.panel.y, 0, 1),
      width: Math.min(best.panel.width, 1 - Math.max(0, best.panel.x)),
      height: Math.min(best.panel.height, 1 - Math.max(0, best.panel.y)),
    },
    confidence: clamp(.48 + (best.score - .34) * 1.5, .48, .97),
    source: 'automatic',
  }
}

const luminance = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const offset = (y * width + x) * 4
  return pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114
}

const verticalScore = (pixels: Uint8ClampedArray, width: number, x: number, top: number, bottom: number) => {
  let score = 0
  let count = 0
  for (let y = top; y <= bottom; y += 2) {
    score += Math.abs(luminance(pixels, width, x - 1, y) - luminance(pixels, width, x + 1, y))
    count += 1
  }
  return count ? score / count : 0
}

const horizontalScore = (pixels: Uint8ClampedArray, width: number, y: number, left: number, right: number) => {
  let score = 0
  let count = 0
  for (let x = left; x <= right; x += 2) {
    score += Math.abs(luminance(pixels, width, x, y - 1) - luminance(pixels, width, x, y + 1))
    count += 1
  }
  return count ? score / count : 0
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

export const refinePanelFromPixels = (imageData: ImageData, coarse: LocatedPanel): LocatedPanel => {
  const { width, height, data } = imageData
  const left0 = coarse.panel.x * width
  const right0 = (coarse.panel.x + coarse.panel.width) * width
  const top0 = coarse.panel.y * height
  const bottom0 = (coarse.panel.y + coarse.panel.height) * height
  const topBand = clamp(Math.round(top0 + height * .03), 2, height - 3)
  const bottomBand = clamp(Math.round(bottom0 - height * .03), 2, height - 3)
  const leftBand = clamp(Math.round(left0 + width * .03), 2, width - 3)
  const rightBand = clamp(Math.round(right0 - width * .03), 2, width - 3)
  const left = strongestLine(left0, width * .012, 2, width - 3, (x) => verticalScore(data, width, x, topBand, bottomBand))
  const right = strongestLine(right0, width * .012, 2, width - 3, (x) => verticalScore(data, width, x, topBand, bottomBand))
  const top = strongestLine(top0, height * .012, 2, height - 3, (y) => horizontalScore(data, width, y, leftBand, rightBand))
  const bottom = strongestLine(bottom0, height * .012, 2, height - 3, (y) => horizontalScore(data, width, y, leftBand, rightBand))
  const valid = right.position - left.position > width * .65 && bottom.position - top.position > height * .55
  if (!valid) return coarse
  const edgeScore = (left.score + right.score + top.score + bottom.score) / 4
  return {
    deviceProfile: coarse.deviceProfile,
    panel: {
      x: left.position / width,
      y: top.position / height,
      width: (right.position - left.position) / width,
      height: (bottom.position - top.position) / height,
    },
    confidence: clamp(coarse.confidence * .65 + edgeScore / 70 * .35, .35, .99),
  }
}
