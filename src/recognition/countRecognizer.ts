import templates from '../data/recognitionTemplates.generated.json'
import { findWhiteGlyphComponents, type DetectedCardSlot, type GlyphComponent, type PixelBuffer } from './cardDetector'

interface DigitTemplate { digit: string, bitmap: string }

const digitTemplates = templates.digitObservations as DigitTemplate[]
const digitTemplateFrequency = digitTemplates.reduce((counts, template) => {
  counts.set(template.digit, (counts.get(template.digit) ?? 0) + 1)
  return counts
}, new Map<string, number>())

const white = (data: Uint8ClampedArray, offset: number) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  return Math.max(red, green, blue) >= 195 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 95
}

const normalizeGlyph = (image: PixelBuffer, originX: number, originY: number, component: GlyphComponent) => {
  let value = 0n
  let bit = 0n
  for (let y = 0; y < 20; y += 1) for (let x = 0; x < 12; x += 1) {
    const sourceX = originX + component.x + Math.min(component.width - 1, Math.floor((x + .5) / 12 * component.width))
    const sourceY = originY + component.y + Math.min(component.height - 1, Math.floor((y + .5) / 20 * component.height))
    if (white(image.data, (sourceY * image.width + sourceX) * 4)) value |= 1n << bit
    bit += 1n
  }
  return value
}

const bitDistance = (left: bigint, right: bigint) => {
  let value = left ^ right
  let count = 0
  while (value) { count += Number(value & 1n); value >>= 1n }
  return count
}

const recognizeDigit = (bitmap: bigint) => {
  const best = new Map<string, number>()
  for (const template of digitTemplates) {
    const distance = bitDistance(bitmap, BigInt(`0x${template.bitmap}`))
    best.set(template.digit, Math.min(best.get(template.digit) ?? 241, distance))
  }
  return [...best].sort((left, right) => left[1] - right[1]
    || (digitTemplateFrequency.get(right[0]) ?? 0) - (digitTemplateFrequency.get(left[0]) ?? 0)).slice(0, 3)
    .map(([digit, distance]) => ({ digit, score: 1 - distance / 240 }))
}

export interface RecognizedCountBadge {
  value?: number
  confidence: number
  candidates?: Array<{ value: number, score: number }>
  constrained?: boolean
  digits: Array<Array<{ digit: string, score: number }>>
  glyphs?: Array<{ x: number, width: number }>
}

const combineDigitCandidates = (digits: Array<Array<{ digit: string, score: number }>>) => {
  let combinations: Array<{ text: string, score: number, length: number }> = [{ text: '', score: 0, length: 0 }]
  for (const candidates of digits) combinations = combinations.flatMap((combination) => candidates.map((candidate) => ({
    text: combination.text + candidate.digit,
    score: combination.score + candidate.score,
    length: combination.length + 1,
  })))
  const best = new Map<number, number>()
  combinations.forEach((combination) => {
    const value = Number(combination.text)
    if (!Number.isSafeInteger(value) || value <= 0 || value > 99) return
    const score = combination.score / Math.max(1, combination.length)
    best.set(value, Math.max(best.get(value) ?? 0, score))
  })
  return [...best].map(([value, score]) => ({ value, score }))
    .sort((left, right) => right.score - left.score || left.value - right.value)
    .slice(0, 9)
}

export const recognizeCardCount = (image: PixelBuffer, slot: DetectedCardSlot): RecognizedCountBadge => {
  const left = Math.round(slot.rect.x * image.width)
  const top = Math.round(slot.rect.y * image.height)
  const width = Math.round(slot.rect.width * image.width)
  const height = Math.max(1, Math.round(slot.rect.height * image.height * .30))
  const scale = Math.max(.7, Math.min(1.35, image.width / 2500))
  const components = findWhiteGlyphComponents(image, { left, top, width, height })
  const glyphs = components.filter((component) =>
    component.width >= 4 * scale && component.width <= 25 * scale
    && component.height >= 11 * scale && component.height <= 29 * scale
    && component.area >= 35 * scale * scale)
  const xGlyph = glyphs.filter((component) =>
    component.width >= 13 * scale && component.width <= 22 * scale
    && component.height >= 13 * scale && component.height <= 25 * scale
    && component.area >= 125 * scale * scale
    && glyphs.some((other) => other.x > component.x + 12 * scale && other.x < component.x + 45 * scale && Math.abs(other.y - component.y) < 10 * scale))
    .sort((a, b) => a.x - b.x)[0]
  if (!xGlyph) {
    // Once the card rectangle is known, a digit in its fixed top-left quantity
    // zone is unambiguous. The `x` often merges with bright ice/lightning art,
    // while the following digit remains a usable standalone component.
    const directComponents = components.filter((component) =>
      component.x >= 20 * scale && component.x <= 78 * scale
      && component.y <= 25 * scale
      && component.width >= 4 * scale && component.width <= 25 * scale
      && component.height >= 10 * scale && component.height <= 30 * scale
      && component.area >= 20 * scale * scale)
      .sort((leftComponent, rightComponent) => leftComponent.x - rightComponent.x)
    const start = [...directComponents].sort((leftComponent, rightComponent) =>
      Math.abs(leftComponent.x - 30 * scale) - Math.abs(rightComponent.x - 30 * scale))[0]
    if (!start) return { confidence: 0, digits: [] }
    const digitGlyphs = directComponents.filter((component) => component.x >= start.x
      && component.x - (start.x + start.width) <= 28 * scale
      && Math.abs(component.y - start.y) <= 10 * scale).slice(0, 2)
    const recognized = digitGlyphs.map((component) => recognizeDigit(normalizeGlyph(image, left, top, component)))
    if (!recognized.length || recognized.some((candidates) => !candidates.length)) return { confidence: 0, digits: recognized }
    const candidates = combineDigitCandidates(recognized)
    if ((candidates[0]?.score ?? 0) < .78) return { confidence: 0, digits: recognized }
    return {
      value: candidates[0].value,
      confidence: candidates[0].score,
      candidates,
      digits: recognized,
      glyphs: digitGlyphs.map(({ x, width: glyphWidth }) => ({ x, width: glyphWidth })),
    }
  }
  const digitCandidates = glyphs.filter((component) => component.x > xGlyph.x + 12 * scale
    && component.x < xGlyph.x + 85 * scale
    && Math.abs(component.y - xGlyph.y) < 10 * scale)
    .sort((a, b) => a.x - b.x)
  const digitGlyphs: GlyphComponent[] = []
  for (const component of digitCandidates) {
    if (!digitGlyphs.length) digitGlyphs.push(component)
    else {
      const previous = digitGlyphs[digitGlyphs.length - 1]
      if (component.x - (previous.x + previous.width) <= 5 * scale) digitGlyphs.push(component)
      else break
    }
  }
  const recognized = digitGlyphs.map((component) => recognizeDigit(normalizeGlyph(image, left, top, component)))
  while (recognized.length > 1 && (recognized[recognized.length - 1][0]?.score ?? 0) < .8) recognized.pop()
  // A bright card-edge fragment can be mistaken for an earlier quantity marker,
  // leaving the real “x” as a low-confidence first digit. Discard that fragment
  // only when the following digit is substantially cleaner.
  if (recognized.length > 1
    && digitGlyphs[0].width >= 13 * scale
    && (recognized[0][0]?.score ?? 0) < .9
    && (recognized[1][0]?.score ?? 0) >= .95) {
    recognized.shift()
    digitGlyphs.shift()
  }
  if (!recognized.length || recognized.some((candidates) => !candidates.length)) return { confidence: 0, digits: recognized }
  const candidates = combineDigitCandidates(recognized)
  const value = candidates[0]?.value
  return {
    ...(Number.isSafeInteger(value) && value > 0 ? { value } : {}),
    confidence: candidates[0]?.score ?? 0,
    candidates,
    digits: recognized,
    glyphs: digitGlyphs.slice(0, recognized.length).map(({ x, width }) => ({ x, width })),
  }
}
