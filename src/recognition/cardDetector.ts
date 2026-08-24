import type { NormalizedRect } from './types'

export interface PixelBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface DetectedCardSlot {
  rect: NormalizedRect
  badgeConfidence: number
  candidates?: Array<{ id: number, kind: 'troop' | 'siege' | 'spell', score: number }>
  count?: {
    value?: number
    confidence: number
    digits: Array<Array<{ digit: string, score: number }>>
    glyphs?: Array<{ x: number, width: number }>
  }
}

export interface GlyphComponent {
  x: number
  y: number
  width: number
  height: number
  area: number
}

const isWhiteGlyphPixel = (data: Uint8ClampedArray, offset: number) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  return Math.max(red, green, blue) >= 195 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 95
}

export const findWhiteGlyphComponents = (image: PixelBuffer, rect: { left: number, top: number, width: number, height: number }) => {
  const visited = new Uint8Array(rect.width * rect.height)
  const components: GlyphComponent[] = []
  const queueX = new Int32Array(rect.width * rect.height)
  const queueY = new Int32Array(rect.width * rect.height)

  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const localIndex = localY * rect.width + localX
      if (visited[localIndex]) continue
      visited[localIndex] = 1
      const sourceOffset = ((rect.top + localY) * image.width + rect.left + localX) * 4
      if (!isWhiteGlyphPixel(image.data, sourceOffset)) continue
      let head = 0
      let tail = 1
      queueX[0] = localX
      queueY[0] = localY
      let minX = localX
      let maxX = localX
      let minY = localY
      let maxY = localY
      let area = 0
      while (head < tail) {
        const x = queueX[head]
        const y = queueY[head]
        head += 1
        area += 1
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nextX < 0 || nextY < 0 || nextX >= rect.width || nextY >= rect.height) continue
          const nextIndex = nextY * rect.width + nextX
          if (visited[nextIndex]) continue
          visited[nextIndex] = 1
          const nextOffset = ((rect.top + nextY) * image.width + rect.left + nextX) * 4
          if (!isWhiteGlyphPixel(image.data, nextOffset)) continue
          queueX[tail] = nextX
          queueY[tail] = nextY
          tail += 1
        }
      }
      components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area })
    }
  }
  return components
}

export const detectCardSlots = (image: PixelBuffer, region: NormalizedRect): DetectedCardSlot[] => {
  const left = Math.max(0, Math.round(region.x * image.width))
  const top = Math.max(0, Math.round(region.y * image.height))
  const width = Math.min(image.width - left, Math.round(region.width * image.width))
  const fullHeight = Math.min(image.height - top, Math.round(region.height * image.height))
  if (width <= 0 || fullHeight <= 0) return []
  const height = Math.max(1, Math.round(fullHeight * .30))
  const scale = Math.max(.35, width / (region.width * 2160))
  const glyphs = findWhiteGlyphComponents(image, { left, top, width, height }).filter((component) =>
    component.width >= 4 * scale && component.width <= 25 * scale
    && component.height >= 11 * scale && component.height <= 29 * scale
    && component.area >= 35 * scale * scale)
  const xGlyphs = glyphs.filter((component) => {
    const looksLikeX = component.width >= 13 * scale && component.width <= 22 * scale
      && component.height >= 13 * scale && component.height <= 25 * scale
      && component.area >= 125 * scale * scale
    if (!looksLikeX) return false
    return glyphs.some((next) => next.x > component.x + 12 * scale
      && next.x < component.x + 45 * scale
      && Math.abs(next.y - component.y) < 10 * scale)
  }).sort((a, b) => a.x - b.x)

  const badges: GlyphComponent[] = []
  for (const glyph of xGlyphs) {
    if (!badges.length || glyph.x - badges[badges.length - 1].x >= 55 * scale) badges.push(glyph)
  }
  if (!badges.length) {
    // Compressed video frames may break the small white `xN` glyph into pieces.
    // Fall back to contiguous cyan/purple card-frame columns inside the known row.
    const columnHits = new Int32Array(width)
    for (let localX = 0; localX < width; localX += 1) for (let localY = 0; localY < fullHeight; localY += 2) {
      const offset = ((top + localY) * image.width + left + localX) * 4
      const red = image.data[offset]
      const green = image.data[offset + 1]
      const blue = image.data[offset + 2]
      if (blue > 105 && (blue > red * 1.08 || blue > green * 1.20)) columnHits[localX] += 1
    }
    const groups: Array<{ left: number, right: number }> = []
    let groupStart = -1
    const threshold = fullHeight * .08
    for (let x = 0; x <= width; x += 1) {
      const active = x < width && columnHits[x] >= threshold
      if (active && groupStart < 0) groupStart = x
      if (!active && groupStart >= 0) {
        if (x - groupStart >= 35 * scale) groups.push({ left: groupStart, right: x })
        groupStart = -1
      }
    }
    return groups.filter((group) => group.right - group.left <= 220 * scale).map((group) => ({
      rect: { x: (left + Math.max(0, group.left - 5 * scale)) / image.width, y: top / image.height, width: Math.min(width - group.left, group.right - group.left + 10 * scale) / image.width, height: fullHeight / image.height },
      badgeConfidence: .45,
    }))
  }
  const gaps = badges.slice(1).map((badge, index) => badge.x - badges[index].x)
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const typicalWidth = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : Math.min(170 * scale, width)
  return badges.map((badge, index) => {
    const cardLeft = Math.max(0, badge.x - 10 * scale)
    const nextLeft = index + 1 < badges.length ? Math.max(cardLeft + 1, badges[index + 1].x - 10 * scale) : Math.min(width, cardLeft + typicalWidth)
    return {
      rect: {
        x: (left + cardLeft) / image.width,
        y: top / image.height,
        width: (nextLeft - cardLeft) / image.width,
        height: fullHeight / image.height,
      },
      badgeConfidence: .9,
    }
  })
}
