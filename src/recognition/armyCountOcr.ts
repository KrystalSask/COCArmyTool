import { findWhiteGlyphComponents, type DetectedCardSlot, type PixelBuffer } from './cardDetector'
import { MODEL_FILES, modelAssetUrl } from './modelManifest'
import { runArmyCountOcr } from './recognitionWorkerClient'
import type { NormalizedRect } from './types'

let charsetPromise: Promise<string[]> | undefined
const charset = () => charsetPromise ??= fetch(modelAssetUrl(MODEL_FILES.charset)).then(async (response) => {
  if (!response.ok) throw new Error(`OCR 字符表加载失败: ${response.status}`)
  const value = await response.json() as string[]
  if (value.length !== 18_710 || value[0] !== 'blank') throw new Error('OCR 字符表与模型输出不一致')
  return value
})

export const parseArmyCountText = (text: string) => {
  const digits = text.match(/[0-9]/g)?.join('') ?? ''
  if (digits.length < 1 || digits.length > 2) return undefined
  const value = Number(digits)
  return value >= 1 && value <= 99 ? value : undefined
}

export const greedyCtcDecode = (values: readonly number[], steps: number, width: number, characters: readonly string[]) => {
  if (values.length !== steps * width || characters.length !== width) throw new Error('OCR CTC 输出形状无效')
  let previous = -1
  let text = ''
  let confidence = 0
  let count = 0
  for (let step = 0; step < steps; step += 1) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let index = 0; index < width; index += 1) {
      const score = values[step * width + index]
      if (score > bestScore) { bestScore = score; bestIndex = index }
    }
    if (bestIndex !== 0 && bestIndex !== previous) {
      text += characters[bestIndex] ?? ''
      confidence += bestScore
      count += 1
    }
    previous = bestIndex
  }
  return { text, confidence: count ? confidence / count : 0 }
}

export const locateCountBadge = (image: PixelBuffer, slot: DetectedCardSlot): NormalizedRect => {
  const left = Math.max(0, Math.round(slot.rect.x * image.width))
  const top = Math.max(0, Math.round(slot.rect.y * image.height))
  const width = Math.max(1, Math.round(slot.rect.width * image.width))
  const cardHeight = Math.max(1, Math.round(slot.rect.height * image.height))
  const height = Math.max(1, Math.round(cardHeight * .30))
  const scale = cardHeight / 160
  const components = findWhiteGlyphComponents(image, { left, top, width, height }).filter((component) =>
    component.width >= 4 * scale && component.width <= 25 * scale
    && component.height >= 11 * scale && component.height <= 29 * scale
    && component.area >= 35 * scale * scale)
  const marker = components.filter((component) => component.width >= 13 * scale && component.width <= 22 * scale
    && component.height >= 13 * scale && component.height <= 25 * scale && component.area >= 125 * scale * scale
    && components.some((other) => other.x > component.x + 12 * scale && other.x < component.x + 45 * scale
      && Math.abs(other.y - component.y) < 10 * scale)).sort((a, b) => a.x - b.x)[0]
  if (!marker) return { x: left / image.width, y: top / image.height, width: Math.min(width, cardHeight * .30) / image.width, height: cardHeight * .25 / image.height }
  const digits = components.filter((component) => component.x > marker.x + 12 * scale && component.x < marker.x + 65 * scale
    && Math.abs(component.y - marker.y) < 10 * scale).sort((a, b) => a.x - b.x).slice(0, 2)
  const right = digits.length ? digits[digits.length - 1].x + digits[digits.length - 1].width : marker.x + 48 * scale
  const cropLeft = Math.max(0, marker.x - 3 * scale)
  const cropTop = Math.max(0, Math.min(marker.y, ...digits.map((digit) => digit.y)) - 3 * scale)
  const cropBottom = Math.min(height, Math.max(marker.y + marker.height, ...digits.map((digit) => digit.y + digit.height)) + 4 * scale)
  return { x: (left + cropLeft) / image.width, y: (top + cropTop) / image.height, width: Math.min(width - cropLeft, right + 4 * scale - cropLeft) / image.width, height: (cropBottom - cropTop) / image.height }
}

const createOcrTensor = (image: PixelBuffer, rect: NormalizedRect, variant: 'raw' | 'gray' | 'contrast') => {
  const sourceX = Math.max(0, Math.round(rect.x * image.width))
  const sourceY = Math.max(0, Math.round(rect.y * image.height))
  const sourceWidth = Math.max(1, Math.min(image.width - sourceX, Math.round(rect.width * image.width)))
  const sourceHeight = Math.max(1, Math.min(image.height - sourceY, Math.round(rect.height * image.height)))
  const stageWidth = Math.max(48, Math.round(sourceWidth * 128 / sourceHeight))
  const finalWidth = Math.max(1, Math.round(stageWidth * 48 / 128))
  const source = document.createElement('canvas')
  source.width = image.width; source.height = image.height
  const sourceContext = source.getContext('2d')
  if (!sourceContext) throw new Error('无法创建 OCR 源画布')
  sourceContext.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  const stage = document.createElement('canvas')
  stage.width = stageWidth; stage.height = 128
  stage.getContext('2d')?.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, stageWidth, 128)
  const output = document.createElement('canvas')
  output.width = finalWidth; output.height = 48
  const context = output.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建 OCR 标准化画布')
  context.drawImage(stage, 0, 0, stageWidth, 128, 0, 0, finalWidth, 48)
  const pixels = context.getImageData(0, 0, finalWidth, 48).data
  const plane = finalWidth * 48
  const tensor = new Float32Array(plane * 3)
  for (let index = 0; index < plane; index += 1) {
    let red = pixels[index * 4], green = pixels[index * 4 + 1], blue = pixels[index * 4 + 2]
    if (variant !== 'raw') {
      let gray = red * .299 + green * .587 + blue * .114
      if (variant === 'contrast') gray = Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128))
      red = gray; green = gray; blue = gray
    }
    // RapidOCR receives OpenCV BGR arrays; preserve that verified channel order.
    tensor[index] = (blue / 255 - .5) / .5
    tensor[plane + index] = (green / 255 - .5) / .5
    tensor[plane * 2 + index] = (red / 255 - .5) / .5
  }
  return { tensor, width: finalWidth }
}

export const recognizeArmyCardCount = async (image: PixelBuffer, slot: DetectedCardSlot) => {
  const badgeRect = locateCountBadge(image, slot)
  const characters = await charset()
  let best: { value?: number, confidence: number, rawText: string, variant: 'raw' | 'gray' | 'contrast' } | undefined
  for (const variant of ['raw', 'gray', 'contrast'] as const) {
    const input = createOcrTensor(image, badgeRect, variant)
    const output = await runArmyCountOcr(input.tensor, input.width)
    const steps = Number(output.dims[1])
    const classes = Number(output.dims[2])
    const decoded = greedyCtcDecode(output.values, steps, classes, characters)
    const candidate = { value: parseArmyCountText(decoded.text), confidence: decoded.confidence, rawText: decoded.text, variant }
    if (!best || (candidate.value !== undefined ? 1 : 0) + candidate.confidence > (best.value !== undefined ? 1 : 0) + best.confidence) best = candidate
    if (candidate.value !== undefined && candidate.confidence >= .8) break
  }
  return { ...best!, badgeRect }
}
