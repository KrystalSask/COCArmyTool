import templates from '../data/recognitionTemplates.generated.json'
import { equipmentOwnerById } from './iconIndex'
import { projectRectToPanel } from './layouts'
import { extractVisualFeature, featureDistance, type VisualFeatureObservation } from './templateMatcher'
import { officialEquipmentObservations } from './officialEquipmentTemplates'
import { resolveHeroEquipmentGlobally, resolveUniqueVisualCandidates, type RankedVisualCandidate } from './heroInference'
import { classifyEquipment } from './equipmentModel'
import { recognitionSettings } from './recognitionSettings'
import type { EquipmentRecognitionDiagnostic, NormalizedRect, ScreenshotPreflight } from './types'

interface HeroObservation extends VisualFeatureObservation {
  sampleId: string
  layout?: string
  heroId?: number
  id?: number
  value?: number
}

export type HeroVisualCandidate = RankedVisualCandidate

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
  equipmentResolution?: 'confirmed-candidate' | 'ambiguous' | 'unrecognized'
  equipmentResolutionGap?: number
  equipment: Array<{ rect: NormalizedRect, candidates: HeroVisualCandidate[], recognition?: EquipmentRecognitionDiagnostic }>
  pet: { rect: NormalizedRect, candidates: HeroVisualCandidate[], recognizedId?: number, resolution?: 'confirmed-candidate' | 'ambiguous' | 'unrecognized' }
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

const createGeometryRects = (
  geometry: keyof typeof geometryX,
  layout: string,
  panel: NormalizedRect,
  dx = 0,
  dy = 0,
  spacing = 1,
) => {
  const base = layout === 'attack'
    ? equipmentRectsByGeometry[geometry]
    : geometryX[geometry].map((x) => [x, 970, 90, 90] as const)
  const anchor = base[0][0]
  return base.map(([x, y, width, height]) => projectRectToPanel(
    panelRect(anchor + (x - anchor) * spacing + dx, y + dy, width, height), panel,
  ))
}

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
  return [...best].sort((left, right) => left[1] - right[1]).slice(0, limit).map(([id, distance]) => ({ id, score: Math.max(0, 1 - distance), source: 'template' as const }))
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

export interface HeroStructureScore {
  score: number
  baselineScore: number
  best: { geometry: keyof typeof geometryX, dx: number, dy: number, spacing: number }
}

/**
 * Scores the repeated hero/equipment grid without looking at icon templates.
 * This is used both to choose the panel and to decide whether a local crop
 * registration is safe to apply.
 */
export const scoreHeroStructure = (pixels: ImageData, layout: string = 'saved'): HeroStructureScore => {
  const panel = { x: 0, y: 0, width: 1, height: 1 }
  const candidates = (['inset', 'full'] as const).flatMap((geometry) =>
    [-12, 0, 12].flatMap((dx) => [-10, 0, 10].flatMap((dy) => [.994, 1, 1.006].map((spacing) => ({
      geometry, dx, dy, spacing,
      score: heroGeometryEdgeScore(pixels, createGeometryRects(geometry, layout, panel, dx, dy, spacing)),
    })))),
  )
  const best = [...candidates].sort((left, right) => right.score - left.score)[0] ?? { geometry: 'inset' as const, dx: 0, dy: 0, spacing: 1, score: 0 }
  const baselines = candidates.filter((candidate) => candidate.dx === 0 && candidate.dy === 0 && candidate.spacing === 1)
  const baseline = [...baselines].sort((left, right) => right.score - left.score)[0] ?? best
  return { score: best.score, baselineScore: baseline.score, best }
}

export const analyzeHeroSubcards = async (source: HTMLCanvasElement, preflight: ScreenshotPreflight): Promise<AnalyzedHeroColumn[]> => {
  const equipmentObservations = [...templates.equipmentObservations as HeroObservation[], ...officialEquipmentObservations]
  const petObservations = templates.petObservations as HeroObservation[]
  const modeObservations = templates.modeObservations as HeroObservation[]
  const geometryRects = (geometry: keyof typeof geometryX, dx = 0, dy = 0, spacing = 1) => createGeometryRects(geometry, preflight.layout, preflight.panel, dx, dy, spacing)
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
  const templatePairsFor = (candidate: HeroGeometryCandidate | undefined) => candidate
    ? resolveHeroEquipmentGlobally(Array.from({ length: 4 }, (_, index) => candidate.rects
      .slice(index * 2, index * 2 + 2)
      .map((rect) => rank(source, rect, equipmentObservations, (item) => item.id ?? -1, 8, preflight.layout))))
    : []
  const baselinePairs = templatePairsFor(baselineBest)
  const challengerPairs = templatePairsFor(challenger)
  const pairIdentity = (pairs: ReturnType<typeof resolveHeroEquipmentGlobally>) => pairs
    .map((pair) => `${pair.heroId ?? '?'}:${pair.selectedIds.map((id) => id ?? '?').join('_')}`)
    .join('|')
  const pairStable = pairIdentity(baselinePairs) === pairIdentity(challengerPairs)
  // Apply a local registration only when both independent structure and
  // template evidence improve. A single template match is not allowed to move
  // all eight equipment slots, and the proposed geometry must preserve the
  // four-column semantic assignment.
  const geometryGain = challenger.edgeScore - (baselineBest?.edgeScore ?? 0)
  const templateGain = (challenger.templateScore ?? 0) - (baselineBest?.templateScore ?? 0)
  const shouldRegister = Boolean(baselineBest && challenger
    && geometryGain >= .035
    && templateGain >= -.045
    && pairStable)
  const selectedGeometry = shouldRegister ? challenger : baselineBest
  if (!selectedGeometry) return []
  const geometry = selectedGeometry.geometry
  const firstX = geometryX[geometry][0]
  const xPositions = geometryX[geometry].map((x) => firstX + (x - firstX) * selectedGeometry.spacing + selectedGeometry.dx)
  const allEquipmentRects = selectedGeometry.rects
  const columns = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const equipmentRects = allEquipmentRects.slice(index * 2, index * 2 + 2)
    const petPanelRect = panelRect(xPositions[index * 2], 858 + selectedGeometry.dy, xPositions[index * 2 + 1] + 90 - xPositions[index * 2], 100)
    const petRect = projectRectToPanel(petPanelRect, preflight.panel)
    const templateEquipmentCandidates = equipmentRects.map((rect) => rank(source, rect, equipmentObservations, (item) => item.id ?? -1, 8, preflight.layout))
    const equipmentRecognition: EquipmentRecognitionDiagnostic[] = []
    const equipmentModelErrors: string[] = []
    const modelEquipmentCandidates: HeroVisualCandidate[][] = equipmentRects.map(() => [])
    const modelUnvalidatedEquipmentIds = new Set<number>()
    const rawEquipmentCandidates = await Promise.all(equipmentRects.map(async (rect, equipmentIndex) => {
      const templateCandidates = templateEquipmentCandidates[equipmentIndex]
      const baseDiagnostic: EquipmentRecognitionDiagnostic = {
        source: 'template', inputRect: rect,
        templateTopCandidates: templateCandidates.map(({ id, score }) => ({ id, score })),
      }
      if (recognitionSettings.equipmentClassifier === 'template') {
        equipmentRecognition[equipmentIndex] = baseDiagnostic
        return templateCandidates
      }
      try {
        const modelResult = await classifyEquipment(source, rect, 8)
        const modelCandidates = modelResult.candidates
        modelEquipmentCandidates[equipmentIndex] = modelCandidates
        modelResult.manifest.evaluation?.realReferenceMissingEquipmentIds?.forEach((id) => modelUnvalidatedEquipmentIds.add(id))
        const templateTop = templateCandidates[0]
        const modelTop = modelCandidates[0]
        const modelOwner = modelTop ? equipmentOwnerById.get(modelTop.id) : undefined
        const templateOwner = templateTop ? equipmentOwnerById.get(templateTop.id) : undefined
        const diagnostic: EquipmentRecognitionDiagnostic = {
          ...baseDiagnostic,
          source: recognitionSettings.equipmentClassifier === 'shadow' ? 'template' : 'onnx',
          modelVersion: modelResult.manifest.modelVersion,
          preprocessingVersion: modelResult.manifest.preprocessingVersion,
          modelTopCandidates: modelCandidates.map(({ id, score }) => ({ id, score })),
          agreement: modelTop?.id === templateTop?.id,
          ownerAgreement: modelOwner !== undefined && modelOwner === templateOwner,
          scoreDelta: (modelTop?.score ?? 0) - (templateTop?.score ?? 0),
        }
        equipmentRecognition[equipmentIndex] = diagnostic
        return recognitionSettings.equipmentClassifier === 'shadow' ? templateCandidates : modelCandidates
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        equipmentModelErrors.push(`equipment-model-fallback:${equipmentIndex}:${message}`)
        equipmentRecognition[equipmentIndex] = baseDiagnostic
        return templateCandidates
      }
    }))
    const petCandidates = rank(source, petRect, petObservations, (item) => item.id ?? -1, 3, preflight.layout)
    return { index, equipmentRects, rawEquipmentCandidates, modelEquipmentCandidates, modelUnvalidatedEquipmentIds, templateEquipmentCandidates, equipmentRecognition, equipmentModelErrors, petRect, petCandidates }
  }))
  const modelEquipmentResolutions = resolveHeroEquipmentGlobally(columns.map((column) =>
    column.modelEquipmentCandidates.every((candidates) => candidates.length > 0)
      ? column.modelEquipmentCandidates
      : column.rawEquipmentCandidates,
  ))
  const templateEquipmentResolutions = resolveHeroEquipmentGlobally(columns.map((column) => column.templateEquipmentCandidates))
  const petResolutions = resolveUniqueVisualCandidates(columns.map((column) => column.petCandidates))
  return columns.map((column, index) => {
    const modelResolution = modelEquipmentResolutions[index]
    const templateResolution = templateEquipmentResolutions[index]
    const modelPairDiffers = modelResolution.selectedIds.some((id, equipmentIndex) => id !== templateResolution.selectedIds[equipmentIndex])
    const modelUsesUnvalidatedClass = modelResolution.selectedIds.some((id) => id !== undefined && column.modelUnvalidatedEquipmentIds.has(id))
    const useTemplateFallback = recognitionSettings.equipmentClassifier === 'onnx'
      && templateResolution.heroId !== undefined
      && (modelResolution.heroId === undefined || modelResolution.heroId !== templateResolution.heroId
        || (modelPairDiffers && modelUsesUnvalidatedClass))
    const useTemplateCandidates = recognitionSettings.equipmentClassifier !== 'onnx' || useTemplateFallback
    const equipmentResolution = useTemplateCandidates ? templateResolution : modelResolution
    const petResolution = petResolutions[index]
    const selectedIds = equipmentResolution.selectedIds
    const sourceCandidates = useTemplateCandidates ? column.templateEquipmentCandidates : column.rawEquipmentCandidates
    const prioritize = (candidates: HeroVisualCandidate[], selectedId: number | undefined) => selectedId === undefined
      ? candidates
      : [candidates.find((candidate) => candidate.id === selectedId)!, ...candidates.filter((candidate) => candidate.id !== selectedId)]
    const equipment = column.equipmentRects.map((rect, equipmentIndex) => ({
      rect,
      candidates: prioritize(sourceCandidates[equipmentIndex], selectedIds[equipmentIndex]),
      recognition: column.equipmentRecognition[equipmentIndex]
        ? { ...column.equipmentRecognition[equipmentIndex], source: useTemplateFallback ? 'template' as const : column.equipmentRecognition[equipmentIndex].source }
        : undefined,
    }))
    const heroId = equipmentResolution.heroId
    const petId = petResolution.selectedId
    const diagnostics = [
      `selected-geometry:${selectedGeometry.geometry}`,
      ...(shouldRegister ? [`local-geometry-registered:${selectedGeometry.dx},${selectedGeometry.dy},${selectedGeometry.spacing}`] : ['local-geometry-baseline']),
      ...equipmentResolution.diagnostics,
      ...(useTemplateFallback ? ['onnx-owner-conflict-template-fallback'] : []),
      ...(useTemplateFallback && modelUsesUnvalidatedClass ? ['onnx-unvalidated-class-template-fallback'] : []),
      ...petResolution.diagnostics,
      ...column.equipmentModelErrors,
      ...(heroId === undefined ? ['equipment-owner-conflict'] : []),
      ...(petId === undefined ? ['low-pet-recognition-score'] : []),
      ...(challenger !== baselineBest && !pairStable ? ['local-geometry-rejected:pair-instability'] : []),
      ...(challenger !== baselineBest ? [`shared-geometry-candidate:${challenger.dx},${challenger.dy},${challenger.spacing},${challenger.edgeScore.toFixed(3)}`] : []),
    ]
    const result: AnalyzedHeroColumn = {
      index,
      ...(heroId === undefined ? {} : { heroId }),
      geometryScore: selectedGeometry.edgeScore,
      diagnostics,
      equipmentResolution: equipmentResolution.status,
      equipmentResolutionGap: equipmentResolution.gap,
      equipment,
      pet: { rect: column.petRect, candidates: prioritize(column.petCandidates, petId), ...(petId === undefined ? {} : { recognizedId: petId }), resolution: petResolution.status },
    }
    if (heroId === 2) {
      const modeRect = projectRectToPanel(panelRect(xPositions[index * 2 + 1] + 28, 263 + selectedGeometry.dy, 52, 48), preflight.panel)
      result.mode = { rect: modeRect, candidates: rank(source, modeRect, modeObservations, (item) => item.value ?? 0, 2, preflight.layout).map((item) => ({ value: item.id as 0 | 1, score: item.score })) }
    }
    return result
  })
}
