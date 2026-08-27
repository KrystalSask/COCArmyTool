import templates from '../data/recognitionTemplates.generated.json'
import { equipmentOwnerById } from './iconIndex'
import { projectRectToPanel } from './layouts'
import { extractVisualFeature, featureDistance, type VisualFeatureObservation } from './templateMatcher'
import { officialEquipmentObservations } from './officialEquipmentTemplates'
import type { NormalizedRect, ScreenshotPreflight } from './types'

interface HeroObservation extends VisualFeatureObservation {
  sampleId: string
  layout?: string
  heroId?: number
  id?: number
  value?: number
}

export interface HeroVisualCandidate { id: number, score: number }

export const recognizedPetId = (candidates: HeroVisualCandidate[]) => {
  const best = candidates[0]
  if (!best) return undefined
  const margin = best.score - (candidates[1]?.score ?? 0)
  return best.score >= .68 || (best.score >= .60 && margin >= .04) ? best.id : undefined
}

export const resolveEquipmentPairCandidates = (slots: HeroVisualCandidate[][]) => {
  if (slots.length !== 2) return slots
  let best: { left: HeroVisualCandidate, right: HeroVisualCandidate, score: number } | undefined
  for (const left of slots[0]) {
    for (const right of slots[1]) {
      const owner = equipmentOwnerById.get(left.id)
      if (left.id === right.id || owner === undefined || owner !== equipmentOwnerById.get(right.id)) continue
      const score = left.score + right.score
      if (!best || score > best.score) best = { left, right, score }
    }
  }
  if (!best) return slots
  const prioritize = (candidates: HeroVisualCandidate[], selected: HeroVisualCandidate) => [selected, ...candidates.filter((candidate) => candidate.id !== selected.id)]
  return [prioritize(slots[0], best.left), prioritize(slots[1], best.right)]
}

export interface AnalyzedHeroColumn {
  index: number
  heroId?: number
  geometryScore: number
  diagnostics: string[]
  equipment: Array<{ rect: NormalizedRect, candidates: HeroVisualCandidate[] }>
  pet: { rect: NormalizedRect, candidates: HeroVisualCandidate[], recognizedId?: number }
  mode?: { rect: NormalizedRect, candidates: Array<{ value: 0 | 1, score: number }> }
}

const geometryX = {
  inset: [100, 197, 317, 412, 533, 627, 748, 842],
  full: [30, 130, 255, 354, 476, 576, 700, 798],
} as const

const equipmentRectsByGeometry = {
  inset: [[104, 970, 86, 90], [200, 970, 87, 90], [319, 970, 89, 90], [417, 971, 88, 89], [535, 970, 86, 90], [633, 970, 87, 90], [752, 971, 87, 90], [846, 971, 88, 89]],
  full: [[35, 977, 91, 88], [135, 971, 88, 88], [259, 973, 87, 86], [356, 971, 90, 91], [480, 972, 90, 90], [579, 971, 91, 90], [703, 973, 91, 89], [804, 972, 87, 87]],
} as const

const rank = <T extends HeroObservation>(source: HTMLCanvasElement, rect: NormalizedRect, sourceObservations: T[], key: (item: T) => number, limit = 3, preferredLayout?: string) => {
  const feature = extractVisualFeature(source, rect)
  if (!feature) return []
  const best = new Map<number, number>()
  sourceObservations.forEach((observation) => {
    const id = key(observation)
    const distance = featureDistance(feature.hash, feature.histogram, observation)
      + (preferredLayout && observation.layout && observation.layout !== preferredLayout ? .05 : 0)
    best.set(id, Math.min(best.get(id) ?? 99, distance))
  })
  return [...best].sort((left, right) => left[1] - right[1]).slice(0, limit).map(([id, distance]) => ({ id, score: Math.max(0, 1 - distance) }))
}

const panelRect = (x: number, y: number, width: number, height: number): NormalizedRect => ({ x: x / 2160, y: y / 1120, width: width / 2160, height: height / 1120 })

interface HeroGeometryCandidate {
  geometry: keyof typeof geometryX
  dx: number
  dy: number
  spacing: number
  rects: NormalizedRect[]
  edgeScore: number
  templateScore?: number
}

const heroGeometryEdgeScore = (pixels: ImageData, rects: NormalizedRect[]) => {
  const luminance = (x: number, y: number) => {
    const boundedX = Math.max(0, Math.min(pixels.width - 1, Math.round(x)))
    const boundedY = Math.max(0, Math.min(pixels.height - 1, Math.round(y)))
    const offset = (boundedY * pixels.width + boundedX) * 4
    return pixels.data[offset] * .299 + pixels.data[offset + 1] * .587 + pixels.data[offset + 2] * .114
  }
  const scores = rects.map((rect) => {
    const left = rect.x * pixels.width, right = (rect.x + rect.width) * pixels.width
    const top = rect.y * pixels.height, bottom = (rect.y + rect.height) * pixels.height
    let total = 0, count = 0
    for (let ratio = .12; ratio <= .88; ratio += .19) {
      const y = top + (bottom - top) * ratio
      total += Math.abs(luminance(left - 2, y) - luminance(left + 2, y)) + Math.abs(luminance(right - 2, y) - luminance(right + 2, y))
      count += 2
    }
    for (let ratio = .15; ratio <= .85; ratio += .18) {
      const x = left + (right - left) * ratio
      total += Math.abs(luminance(x, top - 2) - luminance(x, top + 2)) + Math.abs(luminance(x, bottom - 2) - luminance(x, bottom + 2))
      count += 2
    }
    return Math.min(1, total / Math.max(1, count) / 55)
  })
  return scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length)
}

export const analyzeHeroSubcards = (source: HTMLCanvasElement, preflight: ScreenshotPreflight): AnalyzedHeroColumn[] => {
  const equipmentObservations = [...templates.equipmentObservations as HeroObservation[], ...officialEquipmentObservations]
  const petObservations = templates.petObservations as HeroObservation[]
  const modeObservations = templates.modeObservations as HeroObservation[]
  const geometryRects = (geometry: keyof typeof geometryX, dx = 0, dy = 0, spacing = 1) => {
    const base = preflight.layout === 'attack'
      ? equipmentRectsByGeometry[geometry]
      : geometryX[geometry].map((x) => [x, 970, 90, 90] as const)
    const anchor = base[0][0]
    return base.map(([x, y, width, height]) => projectRectToPanel(
      panelRect(anchor + (x - anchor) * spacing + dx, y + dy, width, height), preflight.panel,
    ))
  }
  // Older samples contain two small edge-inset variants. Select by the actual
  // equipment-card evidence, never by device name, resolution or aspect ratio.
  const sourcePixels = source.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, source.width, source.height)
  const geometryCandidates: HeroGeometryCandidate[] = []
  for (const geometry of ['inset', 'full'] as const) for (const dx of [-12, 0, 12]) for (const dy of [-10, 0, 10]) for (const spacing of [.994, 1, 1.006]) {
    const rects = geometryRects(geometry, dx, dy, spacing)
    geometryCandidates.push({ geometry, dx, dy, spacing, rects, edgeScore: sourcePixels ? heroGeometryEdgeScore(sourcePixels, rects) : 0 })
  }
  const baselineKeys = new Set(['inset:0:0:1', 'full:0:0:1'])
  const finalists = geometryCandidates.sort((left, right) => right.edgeScore - left.edgeScore)
    .filter((candidate, index) => index < 4 || baselineKeys.has(`${candidate.geometry}:${candidate.dx}:${candidate.dy}:${candidate.spacing}`))
  finalists.forEach((candidate) => {
    candidate.templateScore = candidate.rects.reduce((sum, rect) => sum + (rank(source, rect, equipmentObservations, (item) => item.id ?? -1, 1, preflight.layout)[0]?.score ?? 0), 0) / 8
  })
  const baselineBest = finalists.filter((candidate) => candidate.dx === 0 && candidate.dy === 0 && candidate.spacing === 1)
    .sort((left, right) => (right.templateScore ?? 0) - (left.templateScore ?? 0))[0]
  const challenger = finalists.sort((left, right) => ((right.templateScore ?? 0) * .8 + right.edgeScore * .2) - ((left.templateScore ?? 0) * .8 + left.edgeScore * .2))[0]
  // Keep local registration in shadow mode for the same reason as panel
  // registration: existing equipment/pet template scores are not strong enough
  // to move crop geometry without stronger hero-region structure consistency.
  // The army-card ONNX model never participates in hero subcard recognition.
  const selectedGeometry = baselineBest
  const geometry = selectedGeometry.geometry
  const firstX = geometryX[geometry][0]
  const xPositions = geometryX[geometry].map((x) => firstX + (x - firstX) * selectedGeometry.spacing + selectedGeometry.dx)
  const allEquipmentRects = selectedGeometry.rects
  return Array.from({ length: 4 }, (_, index) => {
    const equipmentRects = allEquipmentRects.slice(index * 2, index * 2 + 2)
    const petPanelRect = panelRect(xPositions[index * 2], 858 + selectedGeometry.dy, xPositions[index * 2 + 1] + 90 - xPositions[index * 2], 100)
    const petRect = projectRectToPanel(petPanelRect, preflight.panel)
    const rawEquipmentCandidates = equipmentRects.map((rect) => rank(source, rect, equipmentObservations, (item) => item.id ?? -1, 8, preflight.layout))
    const resolvedEquipmentCandidates = resolveEquipmentPairCandidates(rawEquipmentCandidates)
    const equipment = equipmentRects.map((rect, equipmentIndex) => ({ rect, candidates: resolvedEquipmentCandidates[equipmentIndex] }))
    const petCandidates = rank(source, petRect, petObservations, (item) => item.id ?? -1, 3, preflight.layout)
    const owners = equipment.map((item) => equipmentOwnerById.get(item.candidates[0]?.id)).filter((owner) => owner !== undefined)
    const heroId = owners.length === 2 && owners[0] === owners[1] ? owners[0] : undefined
    const petId = recognizedPetId(petCandidates)
    const diagnostics = [
      `selected-geometry:${selectedGeometry.geometry}`,
      ...(heroId === undefined ? ['equipment-owner-conflict'] : []),
      ...(petId === undefined ? ['low-pet-recognition-score'] : []),
      ...(challenger !== baselineBest ? [`shared-geometry-candidate:${challenger.dx},${challenger.dy},${challenger.spacing},${challenger.edgeScore.toFixed(3)}`] : []),
    ]
    const result: AnalyzedHeroColumn = {
      index,
      ...(heroId === undefined ? {} : { heroId }),
      geometryScore: selectedGeometry.edgeScore,
      diagnostics,
      equipment,
      pet: { rect: petRect, candidates: petCandidates, ...(petId === undefined ? {} : { recognizedId: petId }) },
    }
    if (heroId === 2) {
      const modeRect = projectRectToPanel(panelRect(xPositions[index * 2 + 1] + 28, 263 + selectedGeometry.dy, 52, 48), preflight.panel)
      result.mode = { rect: modeRect, candidates: rank(source, modeRect, modeObservations, (item) => item.value ?? 0, 2, preflight.layout).map((item) => ({ value: item.id as 0 | 1, score: item.score })) }
    }
    return result
  })
}
