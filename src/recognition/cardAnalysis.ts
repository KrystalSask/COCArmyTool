import { getLayoutDefinition, projectLayoutToPanel, projectRectToPanel } from './layouts'
import { detectCardSlots, type DetectedCardSlot } from './cardDetector'
import type { RecognitionRegionKind, ScreenshotPreflight } from './types'
import { rankCardTemplates } from './templateMatcher'
import { recognizeCardCount } from './countRecognizer'
import { analyzeHeroSubcards, type AnalyzedHeroColumn } from './heroSubcardAnalysis'
import { createStandardRecognitionImage } from './imageNormalization'

export interface DetectedRegionCards {
  region: Exclude<RecognitionRegionKind, 'heroes'>
  label: string
  slots: DetectedCardSlot[]
}

export interface ScreenshotVisualAnalysis {
  regions: DetectedRegionCards[]
  heroes: AnalyzedHeroColumn[]
}

const trimTrailingFalseSlots = (slots: DetectedCardSlot[]) => {
  const result = [...slots]
  while (result.length && result[result.length - 1].count?.value === undefined && !result[result.length - 1].candidates?.length) result.pop()
  return result
}

const loadFileImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取截图以分割卡片')) }
  image.src = url
})

export const analyzeCardLayout = async (file: File, preflight: ScreenshotPreflight): Promise<ScreenshotVisualAnalysis> => {
  const definition = getLayoutDefinition(preflight.layout)
  if (!definition) return { regions: [], heroes: [] }
  const image = await loadFileImage(file)
  const sourcePanelWidth = image.naturalWidth * preflight.panel.width
  const useStandardSpace = preflight.deviceProfile === 'generic-landscape' || sourcePanelWidth < 1600
  const standardized = useStandardSpace ? createStandardRecognitionImage(image, image.naturalWidth, image.naturalHeight, preflight.panel) : undefined
  const canvas = standardized?.canvas ?? document.createElement('canvas')
  if (!standardized) {
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d')?.drawImage(image, 0, 0)
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { regions: [], heroes: [] }
  const pixels = standardized?.pixels ?? context.getImageData(0, 0, canvas.width, canvas.height)
  const analysisPanel = standardized ? { x: 0, y: 0, width: 1, height: 1 } : preflight.panel
  const analysisPreflight = standardized ? { ...preflight, width: canvas.width, height: canvas.height, aspectRatio: canvas.width / canvas.height, panel: analysisPanel } : preflight
  const regions = projectLayoutToPanel(definition, analysisPanel).regions.flatMap((region) => {
    if (region.kind === 'heroes') return []
    const regionKind = region.kind
    return [{
      region: regionKind,
      label: region.label,
      slots: trimTrailingFalseSlots(detectCardSlots(pixels, region.rect).map((slot) => ({
        ...slot,
        candidates: rankCardTemplates(canvas, slot, regionKind),
        count: recognizeCardCount(pixels, slot),
      }))).map((slot) => standardized ? { ...slot, rect: projectRectToPanel(slot.rect, preflight.panel) } : slot),
    }]
  })
  const heroes = analyzeHeroSubcards(canvas, analysisPreflight).map((hero) => standardized ? {
    ...hero,
    equipment: hero.equipment.map((item) => ({ ...item, rect: projectRectToPanel(item.rect, preflight.panel) })),
    pet: { ...hero.pet, rect: projectRectToPanel(hero.pet.rect, preflight.panel) },
    ...(hero.mode ? { mode: { ...hero.mode, rect: projectRectToPanel(hero.mode.rect, preflight.panel) } } : {}),
  } : hero)
  return { regions, heroes }
}
