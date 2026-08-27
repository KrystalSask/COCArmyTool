import type { NormalizedRect } from './types'

export interface LocatedGameViewport {
  rect: NormalizedRect
  confidence: number
  cropped: boolean
}

const DARK_LIMIT = 32
const DARK_LINE_RATIO = .88

const isDark = (data: Uint8ClampedArray, offset: number) =>
  Math.max(data[offset], data[offset + 1], data[offset + 2]) <= DARK_LIMIT

const lineRatios = (image: ImageData, axis: 'row' | 'column') => {
  const lineCount = axis === 'row' ? image.height : image.width
  const lineLength = axis === 'row' ? image.width : image.height
  const stride = Math.max(1, Math.floor(lineLength / 256))
  return Array.from({ length: lineCount }, (_, line) => {
    let dark = 0
    let total = 0
    for (let position = 0; position < lineLength; position += stride) {
      const x = axis === 'row' ? position : line
      const y = axis === 'row' ? line : position
      total += 1
      if (isDark(image.data, (y * image.width + x) * 4)) dark += 1
    }
    return total ? dark / total : 0
  })
}

// Only remove dark bands connected to an outer image edge. Requiring several
// consecutive content lines prevents a single subtitle/control line from ending
// a real video bar too early.
const connectedDarkBand = (ratios: number[], reverse = false) => {
  const values = reverse ? [...ratios].reverse() : ratios
  if ((values[0] ?? 0) < DARK_LINE_RATIO) return 0
  let lastDark = -1
  let contentRun = 0
  const requiredContentRun = Math.max(2, Math.round(values.length * .004))
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= DARK_LINE_RATIO) {
      lastDark = index
      contentRun = 0
    } else {
      contentRun += 1
      if (contentRun >= requiredContentRun) break
    }
  }
  return lastDark + 1
}

export const locateGameViewport = (image: ImageData): LocatedGameViewport => {
  if (image.width <= 0 || image.height <= 0) return { rect: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0, cropped: false }
  const rows = lineRatios(image, 'row')
  const columns = lineRatios(image, 'column')
  const top = connectedDarkBand(rows)
  const bottomInset = connectedDarkBand(rows, true)
  const left = connectedDarkBand(columns)
  const rightInset = connectedDarkBand(columns, true)
  const right = image.width - rightInset
  const bottom = image.height - bottomInset
  const remainingWidth = right - left
  const remainingHeight = bottom - top
  const aspect = remainingHeight > 0 ? remainingWidth / remainingHeight : 0
  const enoughContent = remainingWidth >= image.width * .18 && remainingHeight >= image.height * .18
  const plausibleLandscape = aspect >= 1.25 && aspect <= 2.65
  if (!enoughContent || !plausibleLandscape) return { rect: { x: 0, y: 0, width: 1, height: 1 }, confidence: .25, cropped: false }
  const croppedPixels = top + bottomInset + left + rightInset
  const cropped = croppedPixels > 0
  const edgeEvidence = [
    ...(top ? rows.slice(0, top) : []),
    ...(bottomInset ? rows.slice(rows.length - bottomInset) : []),
    ...(left ? columns.slice(0, left) : []),
    ...(rightInset ? columns.slice(columns.length - rightInset) : []),
  ]
  const meanDarkness = edgeEvidence.length ? edgeEvidence.reduce((sum, value) => sum + value, 0) / edgeEvidence.length : 0
  return {
    rect: { x: left / image.width, y: top / image.height, width: remainingWidth / image.width, height: remainingHeight / image.height },
    confidence: cropped ? Math.min(.99, .68 + Math.max(0, meanDarkness - DARK_LINE_RATIO) * 2) : .55,
    cropped,
  }
}

export const cropImageData = (image: ImageData, rect: NormalizedRect): ImageData => {
  const left = Math.max(0, Math.min(image.width - 1, Math.round(rect.x * image.width)))
  const top = Math.max(0, Math.min(image.height - 1, Math.round(rect.y * image.height)))
  const right = Math.max(left + 1, Math.min(image.width, Math.round((rect.x + rect.width) * image.width)))
  const bottom = Math.max(top + 1, Math.min(image.height, Math.round((rect.y + rect.height) * image.height)))
  const width = right - left
  const height = bottom - top
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * image.width + left) * 4
    data.set(image.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4)
  }
  return { width, height, data, colorSpace: image.colorSpace } as ImageData
}

export const projectRectFromViewport = (rect: NormalizedRect, viewport: NormalizedRect): NormalizedRect => ({
  x: viewport.x + rect.x * viewport.width,
  y: viewport.y + rect.y * viewport.height,
  width: rect.width * viewport.width,
  height: rect.height * viewport.height,
})
