import { getLayoutDefinition, projectLayoutToPanel, projectRectToPanel } from './layouts'
import { detectCardSlots, type DetectedCardSlot } from './cardDetector'
import type { NormalizedRect, PanelCandidateDiagnostic, RecognitionRegionKind, ScreenshotPreflight } from './types'
import { rankCardTemplates } from './templateMatcher'
import { recognizeCardCount } from './countRecognizer'
import { analyzeHeroSubcards, scoreHeroStructure, type AnalyzedHeroColumn } from './heroSubcardAnalysis'
import { createStandardRecognitionImage } from './imageNormalization'
import { validateCardRules, type RecognitionRuleValidation } from './countConstraints'
import { normalizeArmyCardCrop } from './armyCardCrop'
import { classifyArmyCard } from './armyCardClassifier'
import { recognizeArmyCardCount } from './armyCountOcr'
import { recognitionSettings } from './recognitionSettings'
import { LIMITS } from '../domain/validation'

export interface DetectedRegionCards {
  region: Exclude<RecognitionRegionKind, 'heroes'>
  label: string
  slots: DetectedCardSlot[]
  validation: RecognitionRuleValidation
}

export interface ScreenshotVisualAnalysis {
  regions: DetectedRegionCards[]
  heroes: AnalyzedHeroColumn[]
  selectedPanel?: NormalizedRect
  panelCandidates?: PanelCandidateDiagnostic[]
  panelSelectionGap?: number
}

const recognizeArmySlot = async (
  canvas: HTMLCanvasElement, pixels: ReturnType<typeof createStandardRecognitionImage>['pixels'],
  slot: DetectedCardSlot, region: Exclude<RecognitionRegionKind, 'heroes'>,
) => {
  const legacyCandidates = rankCardTemplates(canvas, slot, region, region === 'castleArmy' ? 8 : 3)
  const legacyCount = recognizeCardCount(pixels, slot)
  let candidates = legacyCandidates
  let classification: NonNullable<DetectedCardSlot['classification']> = {
    candidates, source: 'legacy-template', modelVersion: 'recognition-templates-generated', preprocessingVersion: 'legacy-feature-v1',
  }
  if (recognitionSettings.cardClassifier === 'onnx') {
    try {
      candidates = await classifyArmyCard(normalizeArmyCardCrop(pixels, slot), region, region === 'castleArmy' ? 8 : 3)
      classification = {
        candidates,
        // Keep the old visual matcher as independent shadow evidence. It is
        // not a general replacement for ONNX; it is used only by the narrow
        // low-confidence correction below.
        shadowCandidates: legacyCandidates,
        source: 'onnx',
        modelVersion: 'army-card-classifier-cn-v2',
        preprocessingVersion: 'army-card-left-pad-rgb-chw-div255-v1',
      }
    } catch (error) {
      console.warn('Army card classifier degraded to templates', error)
    }
  }
  // The castle row contains smaller/narrower cards than the main troop row.
  // On sample families with that presentation, ONNX can confidently choose a
  // same-kind class while the independent template matcher points elsewhere.
  // Correct only when all signals make the correction explainable: castle
  // region, low formal confidence, a strong shadow winner, and a meaningful
  // margin. This deliberately avoids sample-specific IDs and leaves
  // high-confidence model results untouched.
  if (classification.source === 'onnx') {
    const formalTop = candidates[0]
    const shadowTop = classification.shadowCandidates?.[0]
    const shadowResolvesLowConfidence = Boolean(formalTop && shadowTop
      && region === 'castleArmy'
      && formalTop.kind === shadowTop.kind
      && formalTop.id !== shadowTop.id
      && formalTop.score < .8
      && shadowTop.score >= .72
      && shadowTop.score - formalTop.score >= .015)
    if (shadowResolvesLowConfidence && formalTop && shadowTop) {
      candidates = [shadowTop, ...candidates.filter((candidate) => candidate.id !== shadowTop.id || candidate.kind !== shadowTop.kind)]
      classification = { ...classification, candidates, resolvedBy: 'shadow-template' }
      slot.diagnostics = [...(slot.diagnostics ?? []), `category-shadow-correction:${formalTop.kind}:${formalTop.id}->${shadowTop.id}`]
    }
  }
  let count: NonNullable<DetectedCardSlot['count']> = {
    ...legacyCount, source: legacyCount.value === undefined ? 'none' : 'legacy-bitmap', preprocessingVariant: 'none', rawText: legacyCount.value?.toString() ?? '',
  }
  if (recognitionSettings.countRecognizer === 'ppocrv6') {
    try {
      const ocr = await recognizeArmyCardCount(pixels, slot)
      count = {
        value: ocr.value, confidence: ocr.confidence, digits: [], rawText: ocr.rawText,
        badgeRect: ocr.badgeRect, source: 'ppocrv6', preprocessingVariant: ocr.variant,
      }
    } catch (error) {
      console.warn('Army count OCR degraded to bitmap recognition', error)
    }
  }
  return { ...slot, geometry: slot.geometry ?? { source: 'legacy-detector' as const, score: slot.badgeConfidence, inferred: slot.badgeConfidence < .9 }, candidates, classification, count }
}

const trimTrailingFalseSlots = (slots: DetectedCardSlot[], region: Exclude<RecognitionRegionKind, 'heroes'>) => {
  // Geometry owns card existence. OCR quantities, capacity and duplicate rules
  // must never add a slot. A narrow inferred tail is removable only when the
  // preceding, readable siege cards already exhaust the visible 3-machine
  // capacity; this is explicit false-tail evidence, not quantity inference.
  if (region !== 'mainSiege') return slots
  const trimmed = [...slots]
  while (trimmed.length > 1
    && trimmed.at(-1)?.geometry?.inferred
    && trimmed.at(-1)?.count?.value === undefined) {
    const knownMachines = trimmed.slice(0, -1).reduce((sum, slot) => {
      const selected = slot.candidates?.[0]
      return selected?.kind === 'siege' && slot.count?.value !== undefined ? sum + slot.count.value : sum
    }, 0)
    if (knownMachines !== LIMITS.siegeMachines) break
    trimmed.pop()
  }
  return trimmed
}

const trimWeakCastleTail = (slots: DetectedCardSlot[], region: Exclude<RecognitionRegionKind, 'heroes'>) => {
  if (region !== 'castleArmy') return slots
  const trimmed = [...slots]
  while (trimmed.length > 1) {
    const last = trimmed.at(-1)
    const frame = Number(last?.diagnostics?.find((item) => item.startsWith('blue-frame:'))?.split(':')[1] ?? 1)
    if ((last?.count?.confidence ?? 1) >= .5 || frame >= .08) break
    trimmed.pop()
  }
  return trimmed
}

const loadFileImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取截图以分割卡片')) }
  image.src = url
})

const panelDistance = (left: NormalizedRect, right: NormalizedRect) => Math.max(
  Math.abs(left.x - right.x), Math.abs(left.y - right.y),
  Math.abs(left.width - right.width), Math.abs(left.height - right.height),
)

const coefficientConsistency = (values: number[]) => {
  if (values.length < 2) return values.length ? .75 : 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (!mean) return 0
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.max(0, 1 - Math.sqrt(variance) / mean * 4)
}

const scorePanelCardStructure = (image: CanvasImageSource, width: number, height: number, panel: NormalizedRect, preflight: ScreenshotPreflight) => {
  const definition = getLayoutDefinition(preflight.layout)
  if (!definition) return { cardStructureScore: 0, consistencyScore: 0, heroStructureScore: 0 }
  const standardized = createStandardRecognitionImage(image, width, height, panel)
  const regions = projectLayoutToPanel(definition, { x: 0, y: 0, width: 1, height: 1 }).regions.filter((region) => region.kind !== 'heroes')
  const regionScores = regions.map((region) => {
    const slots = detectCardSlots(standardized.pixels, region.rect, { trimTrailingFrameless: region.kind === 'castleArmy' })
    if (!slots.length) return { structure: 0, consistency: 0 }
    const widths = slots.map((slot) => slot.rect.width)
    const pitches = slots.slice(1).map((slot, index) => slot.rect.x - slots[index].rect.x)
    const geometry = slots.reduce((sum, slot) => sum + (slot.geometry?.score ?? slot.badgeConfidence), 0) / slots.length
    const badges = slots.reduce((sum, slot) => sum + slot.badgeConfidence, 0) / slots.length
    const readable = slots.filter((slot) => recognizeCardCount(standardized.pixels, slot).value !== undefined).length / slots.length
    const consistency = coefficientConsistency(widths) * .55 + coefficientConsistency(pitches) * .45
    const plausibleCount = region.kind === 'mainSiege' ? slots.length <= 4 : slots.length <= 16
    const rawStructure = geometry * .30 + badges * .20 + readable * .25 + consistency * .20 + (plausibleCount ? .05 : 0)
    // A whole functional row with no visible xN badge is much more likely to
    // be a repeated background/card-edge sequence than a valid army row.
    const structure = readable === 0 ? Math.min(rawStructure, .22) : rawStructure
    return { structure, consistency }
  })
  return {
    cardStructureScore: regionScores.reduce((sum, score) => sum + score.structure, 0) / regionScores.length,
    consistencyScore: regionScores.reduce((sum, score) => sum + score.consistency, 0) / regionScores.length,
    heroStructureScore: scoreHeroStructure(standardized.pixels, preflight.layout).score,
  }
}

export const analyzeCardLayout = async (file: File, preflight: ScreenshotPreflight): Promise<ScreenshotVisualAnalysis> => {
  const definition = getLayoutDefinition(preflight.layout)
  if (!definition) return { regions: [], heroes: [] }
  const image = await loadFileImage(file)
  // 手动提交的面板是用户强先验：四个坐标直接锁定为分析面板，不参与卡片
  // 结构候选评分与重选。自动初始检测继续走现有候选与评分路径。
  const manualLocked = preflight.panelSource === 'manual'
  const rawCandidates: PanelCandidateDiagnostic[] = [
    {
      id: 'legacy-production', panel: preflight.panel, source: preflight.panelSource === 'manual' ? 'manual' : preflight.panelSource === 'fallback' ? 'fallback' : 'structure',
      geometryScore: preflight.panelConfidence, anchorEvidence: [],
    },
    ...(preflight.panelCandidates ?? []),
  ]
  const uniqueCandidates = rawCandidates.filter((candidate, index, all) => all.findIndex((other) => panelDistance(candidate.panel, other.panel) < .001) === index).slice(0, 6)
  const scoredCandidates = manualLocked ? [] : uniqueCandidates.map((candidate) => {
    const structure = scorePanelCardStructure(image, image.naturalWidth, image.naturalHeight, candidate.panel, preflight)
    const heroEvidence = candidate.anchorEvidence.find((evidence) => evidence.kind === 'hero-columns')?.score ?? .5
    // Army rows alone can be correct while the left hero area is shifted. Keep
    // hero structure as an independent term so a right-side-only match cannot
    // silently win the panel selection.
    const totalScore = candidate.geometryScore * .16 + structure.cardStructureScore * .43
      + structure.heroStructureScore * .29 + heroEvidence * .05 + structure.consistencyScore * .07
    return { ...candidate, ...structure, totalScore }
  }).sort((left, right) => (right.totalScore ?? 0) - (left.totalScore ?? 0))
  const selectedPanel = manualLocked ? preflight.panel : scoredCandidates[0]?.panel ?? preflight.panel
  const reportedCandidates = manualLocked ? [] : scoredCandidates.slice(0, 5)
  const panelSelectionGap = scoredCandidates.length > 1
    ? Math.max(0, (scoredCandidates[0].totalScore ?? 0) - (scoredCandidates[1].totalScore ?? 0))
    : undefined
  // Device resolution only stretches the stable panel UI. Always reverse that
  // stretch into one canonical space before applying relative layout regions.
  const standardized = createStandardRecognitionImage(image, image.naturalWidth, image.naturalHeight, selectedPanel)
  const canvas = standardized.canvas
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { regions: [], heroes: [] }
  const pixels = standardized.pixels
  const analysisPanel = { x: 0, y: 0, width: 1, height: 1 }
  const analysisPreflight = { ...preflight, width: canvas.width, height: canvas.height, aspectRatio: canvas.width / canvas.height, panel: analysisPanel }
  const armyRegions = projectLayoutToPanel(definition, analysisPanel).regions.flatMap((region) => region.kind === 'heroes'
    ? []
    : [{ ...region, kind: region.kind as Exclude<RecognitionRegionKind, 'heroes'> }])
  const regions = await Promise.all(armyRegions.map(async (region) => {
    const regionKind = region.kind
    const rankedSlots = trimWeakCastleTail(trimTrailingFalseSlots(await Promise.all(detectCardSlots(pixels, region.rect, { trimTrailingFrameless: regionKind === 'castleArmy' })
      .map((slot) => recognizeArmySlot(canvas, pixels, slot, regionKind))), regionKind), regionKind)
    const validation = validateCardRules(regionKind, rankedSlots)
    return {
      region: regionKind,
      label: region.label,
      validation,
      slots: rankedSlots.map((slot, index) => ({
        ...slot,
        rect: projectRectToPanel(slot.rect, selectedPanel),
        validationIssues: validation.issues.filter((issue) => issue.slotIndexes.includes(index)).map((issue) => issue.message),
        suggestions: validation.suggestions.filter((suggestion) => suggestion.slotIndex === index).map(({ kind, message, value }) => ({ kind, message, value })),
      })),
    }
  }))
  const heroes = (await analyzeHeroSubcards(canvas, analysisPreflight)).map((hero) => ({
    ...hero,
    equipment: hero.equipment.map((item) => ({
      ...item,
      rect: projectRectToPanel(item.rect, selectedPanel),
      ...(item.recognition ? { recognition: { ...item.recognition, inputRect: projectRectToPanel(item.recognition.inputRect, selectedPanel) } } : {}),
    })),
    pet: { ...hero.pet, rect: projectRectToPanel(hero.pet.rect, selectedPanel) },
    ...(hero.mode ? { mode: { ...hero.mode, rect: projectRectToPanel(hero.mode.rect, selectedPanel) } } : {}),
  }))
  return { regions, heroes, selectedPanel, panelCandidates: reportedCandidates, panelSelectionGap }
}
