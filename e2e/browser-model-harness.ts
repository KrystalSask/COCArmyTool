import { normalizeArmyCardCrop } from '../src/recognition/armyCardCrop'
import { classifyArmyCard } from '../src/recognition/armyCardClassifier'
import { recognizeArmyCardCount } from '../src/recognition/armyCountOcr'
import type { DetectedCardSlot, PixelBuffer } from '../src/recognition/cardDetector'
import type { RecognitionRegionKind } from '../src/recognition/types'

const loadPixels = (url: string) => new Promise<PixelBuffer>((resolve, reject) => {
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return reject(new Error('missing canvas context'))
    context.drawImage(image, 0, 0)
    resolve({ width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data })
  }
  image.onerror = () => reject(new Error(`failed to load ${url}`))
  image.src = url
})

const fullSlot: DetectedCardSlot = { rect: { x: 0, y: 0, width: 1, height: 1 }, badgeConfidence: 1 }

export const evaluateNormalizedCards = async (entries: Array<{ url: string, region: Exclude<RecognitionRegionKind, 'heroes'> }>) => {
  const results = []
  for (const entry of entries) {
    const pixels = await loadPixels(entry.url)
    const candidates = await classifyArmyCard(normalizeArmyCardCrop(pixels, fullSlot), entry.region, entry.region === 'castleArmy' ? 8 : 3)
    const count = await recognizeArmyCardCount(pixels, fullSlot)
    results.push({ top1: `${candidates[0].kind}_${String(candidates[0].id).padStart(3, '0')}`, count: count.value, rawText: count.rawText })
  }
  return results
}
