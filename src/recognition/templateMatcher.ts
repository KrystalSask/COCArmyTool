import templates from '../data/recognitionTemplates.generated.json'
import type { RecognitionRegionKind } from './types'
import type { DetectedCardSlot } from './cardDetector'
import type { NormalizedRect } from './types'
import { officialSpellObservations } from './officialSpellTemplates'

export interface VisualFeatureObservation {
  dhash: string
  hsvHistogram: number[]
}

interface TemplateFeatureObservation extends VisualFeatureObservation {
  kind: 'troop' | 'siege' | 'spell'
  id: number
}

const observations = [...templates.observations as TemplateFeatureObservation[], ...officialSpellObservations]

const allowedKinds = (region: Exclude<RecognitionRegionKind, 'heroes'>, spellFrame = false) => region === 'mainTroops'
  ? new Set(['troop'])
  : region === 'mainSpells'
    ? new Set(['spell'])
    : region === 'mainSiege'
      ? new Set(['siege'])
      : spellFrame ? new Set(['spell']) : new Set(['troop', 'siege', 'spell'])

const median = (values: number[]) => {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)] ?? 0
}

const normalizeVisual = (source: HTMLCanvasElement, rect: NormalizedRect, maskOverlays: boolean) => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.drawImage(source, rect.x * source.width, rect.y * source.height, rect.width * source.width, rect.height * source.height, 0, 0, 64, 64)
  const image = context.getImageData(0, 0, 64, 64)
  const channels: number[][] = [[], [], []]
  for (let offset = 0; offset < image.data.length; offset += 4) {
    channels[0].push(image.data[offset])
    channels[1].push(image.data[offset + 1])
    channels[2].push(image.data[offset + 2])
  }
  const neutral = channels.map(median)
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    if (!maskOverlays || !((y < 17 && x < 27) || (y >= 45 && x < 24))) continue
    const offset = (y * 64 + x) * 4
    image.data[offset] = neutral[0]
    image.data[offset + 1] = neutral[1]
    image.data[offset + 2] = neutral[2]
  }
  context.putImageData(image, 0, 0)
  return canvas
}

const differenceHash = (canvas: HTMLCanvasElement) => {
  const reduced = document.createElement('canvas')
  reduced.width = 9
  reduced.height = 8
  const context = reduced.getContext('2d', { willReadFrequently: true })
  if (!context) return 0n
  context.drawImage(canvas, 0, 0, 9, 8)
  const data = context.getImageData(0, 0, 9, 8).data
  let hash = 0n
  let bit = 0n
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const left = (y * 9 + x) * 4
    const right = left + 4
    const leftLuma = data[left] * .299 + data[left + 1] * .587 + data[left + 2] * .114
    const rightLuma = data[right] * .299 + data[right + 1] * .587 + data[right + 2] * .114
    if (leftLuma > rightLuma) hash |= 1n << bit
    bit += 1n
  }
  return hash
}

const rgbToHsv = (red: number, green: number, blue: number) => {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  let hue = 0
  if (delta && maximum === r) hue = ((g - b) / delta) % 6
  else if (delta && maximum === g) hue = (b - r) / delta + 2
  else if (delta) hue = (r - g) / delta + 4
  hue = ((hue * 30) + 180) % 180
  return [hue, maximum ? delta / maximum * 255 : 0, maximum * 255]
}

const hsvHistogram = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const data = context?.getImageData(0, 0, 64, 64).data
  const histogram = Array.from({ length: 128 }, () => 0)
  if (!data) return histogram
  for (let offset = 0; offset < data.length; offset += 4) {
    const [hue, saturation, value] = rgbToHsv(data[offset], data[offset + 1], data[offset + 2])
    const index = Math.min(7, Math.floor(hue / 22.5)) * 16 + Math.min(3, Math.floor(saturation / 64)) * 4 + Math.min(3, Math.floor(value / 64))
    histogram[index] += 1 / 4096
  }
  return histogram
}

const hasSpellFrame = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const data = context?.getImageData(26, 1, 32, 2).data
  if (!data) return false
  const hues: number[] = []
  for (let offset = 0; offset < data.length; offset += 4) hues.push(rgbToHsv(data[offset], data[offset + 1], data[offset + 2])[0])
  return median(hues) >= 132
}

const electricBlueRatio = (canvas: HTMLCanvasElement) => {
  const data = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, 64, 64).data
  if (!data) return 0
  let matched = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    if (blue > 150 && green > 75 && red < 90 && blue > green * 1.15) matched += 1
  }
  return matched / 4096
}

const hammingDistance = (left: bigint, right: bigint) => {
  let value = left ^ right
  let count = 0
  while (value) { count += Number(value & 1n); value >>= 1n }
  return count / 64
}

export const featureDistance = (hash: bigint, histogram: number[], observation: VisualFeatureObservation) => {
  let chiSquare = 0
  const observationTotal = observation.hsvHistogram.reduce((sum, value) => sum + value, 0) || 1
  for (let index = 0; index < histogram.length; index += 1) {
    const observed = observation.hsvHistogram[index] / observationTotal
    const sum = histogram[index] + observed
    if (sum > 0) chiSquare += (histogram[index] - observed) ** 2 / sum
  }
  return .65 * hammingDistance(hash, BigInt(`0x${observation.dhash}`)) + .35 * Math.min(1, chiSquare * .5)
}

export const extractVisualFeature = (source: HTMLCanvasElement, rect: NormalizedRect, maskOverlays = false) => {
  const normalized = normalizeVisual(source, rect, maskOverlays)
  if (!normalized) return undefined
  return { hash: differenceHash(normalized), histogram: hsvHistogram(normalized), normalized }
}

export const rankCardTemplates = (source: HTMLCanvasElement, slot: DetectedCardSlot, region: Exclude<RecognitionRegionKind, 'heroes'>, limit = 3) => {
  const feature = extractVisualFeature(source, slot.rect, true)
  if (!feature) return []
  const { hash, histogram, normalized } = feature
  const kinds = allowedKinds(region, region === 'castleArmy' && hasSpellFrame(normalized))
  const lightningEvidence = region === 'mainSpells' ? electricBlueRatio(normalized) : 0
  const best = new Map<string, { id: number, kind: 'troop' | 'siege' | 'spell', distance: number }>()
  for (const observation of observations) {
    if (!kinds.has(observation.kind)) continue
    const key = `${observation.kind}:${observation.id}`
    const distance = featureDistance(hash, histogram, observation)
      - (observation.kind === 'spell' && observation.id === 0 && lightningEvidence >= .20 ? .15 : 0)
    const previous = best.get(key)
    if (!previous || distance < previous.distance) best.set(key, { id: observation.id, kind: observation.kind, distance })
  }
  return [...best.values()].sort((left, right) => left.distance - right.distance).slice(0, limit)
    .map((candidate) => ({ id: candidate.id, kind: candidate.kind, score: Math.max(0, 1 - candidate.distance) }))
}

export const recognitionTemplateCoverage = templates.coverage
