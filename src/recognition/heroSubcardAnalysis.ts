import templates from '../data/recognitionTemplates.generated.json'
import { equipmentOwnerById } from './iconIndex'
import { projectRectToPanel } from './layouts'
import { extractVisualFeature, featureDistance, type VisualFeatureObservation } from './templateMatcher'
import type { NormalizedRect, ScreenshotPreflight } from './types'

interface HeroObservation extends VisualFeatureObservation {
  sampleId: string
  layout?: string
  heroId?: number
  id?: number
  value?: number
}

export interface HeroVisualCandidate { id: number, score: number }

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
  equipment: Array<{ rect: NormalizedRect, candidates: HeroVisualCandidate[] }>
  pet: { rect: NormalizedRect, candidates: HeroVisualCandidate[] }
  mode?: { rect: NormalizedRect, candidates: Array<{ value: 0 | 1, score: number }> }
}

const deviceX = {
  'iphone-17': [100, 197, 317, 412, 533, 627, 748, 842],
  'ipad-pro-2024-11': [30, 130, 255, 354, 476, 576, 700, 798],
} as const

const equipmentRectsByDevice = {
  'iphone-17': [[104, 970, 86, 90], [200, 970, 87, 90], [319, 970, 89, 90], [417, 971, 88, 89], [535, 970, 86, 90], [633, 970, 87, 90], [752, 971, 87, 90], [846, 971, 88, 89]],
  'ipad-pro-2024-11': [[35, 977, 91, 88], [135, 971, 88, 88], [259, 973, 87, 86], [356, 971, 90, 91], [480, 972, 90, 90], [579, 971, 91, 90], [703, 973, 91, 89], [804, 972, 87, 87]],
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

export const analyzeHeroSubcards = (source: HTMLCanvasElement, preflight: ScreenshotPreflight): AnalyzedHeroColumn[] => {
  // Generic/video panels are normalized from the full four-column layout, whose
  // subcard geometry matches the iPad panel rather than the edge-cropped iPhone panel.
  const usesWideHeroGeometry = preflight.deviceProfile !== 'iphone-17'
  const xPositions = usesWideHeroGeometry ? deviceX['ipad-pro-2024-11'] : deviceX['iphone-17']
  const equipmentObservations = templates.equipmentObservations as HeroObservation[]
  const petObservations = templates.petObservations as HeroObservation[]
  const modeObservations = templates.modeObservations as HeroObservation[]
  const device = usesWideHeroGeometry ? 'ipad-pro-2024-11' : 'iphone-17'
  return Array.from({ length: 4 }, (_, index) => {
    const equipmentRects = preflight.layout === 'attack'
      ? equipmentRectsByDevice[device].slice(index * 2, index * 2 + 2)
        .map(([x, y, width, height]) => projectRectToPanel(panelRect(x, y, width, height), preflight.panel))
      : [xPositions[index * 2], xPositions[index * 2 + 1]]
        .map((x) => projectRectToPanel(panelRect(x, 970, 90, 90), preflight.panel))
    const petPanelRect = panelRect(xPositions[index * 2], 858, xPositions[index * 2 + 1] + 90 - xPositions[index * 2], 100)
    const petRect = projectRectToPanel(petPanelRect, preflight.panel)
    const rawEquipmentCandidates = equipmentRects.map((rect) => rank(source, rect, equipmentObservations, (item) => item.id ?? -1, 3, preflight.layout))
    const resolvedEquipmentCandidates = resolveEquipmentPairCandidates(rawEquipmentCandidates)
    const equipment = equipmentRects.map((rect, equipmentIndex) => ({ rect, candidates: resolvedEquipmentCandidates[equipmentIndex] }))
    const rankedPets = rank(source, petRect, petObservations, (item) => item.id ?? -1, 3, preflight.layout)
    const petThreshold = preflight.deviceProfile === 'generic-landscape' ? .58 : .72
    const petCandidates = (rankedPets[0]?.score ?? 0) >= petThreshold ? rankedPets : []
    const owners = equipment.map((item) => equipmentOwnerById.get(item.candidates[0]?.id)).filter((owner) => owner !== undefined)
    const heroId = owners.length === 2 && owners[0] === owners[1] ? owners[0] : undefined
    const result: AnalyzedHeroColumn = { index, ...(heroId === undefined ? {} : { heroId }), equipment, pet: { rect: petRect, candidates: petCandidates } }
    if (heroId === 2) {
      const modeRect = projectRectToPanel(panelRect(xPositions[index * 2 + 1] + 28, 263, 52, 48), preflight.panel)
      result.mode = { rect: modeRect, candidates: rank(source, modeRect, modeObservations, (item) => item.value ?? 0, 2, preflight.layout).map((item) => ({ value: item.id as 0 | 1, score: item.score })) }
    }
    return result
  })
}
