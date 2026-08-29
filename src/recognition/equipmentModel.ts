import type { NormalizedRect } from './types'
import type { EquipmentModelManifest } from './modelManifest'
import type { RankedVisualCandidate } from './heroInference'
import { runEquipmentClassifier } from './recognitionWorkerClient'

export const EQUIPMENT_MODEL_SIZE = 96

const averageColor = (pixels: Uint8ClampedArray) => {
  const sums = [0, 0, 0]
  let count = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    sums[0] += pixels[offset]
    sums[1] += pixels[offset + 1]
    sums[2] += pixels[offset + 2]
    count += 1
  }
  return count ? sums.map((value) => Math.round(value / count)) : [57, 64, 71]
}

/** Matches the model's 96x96 RGB letterbox preprocessing. */
export const normalizeEquipmentCrop = (source: HTMLCanvasElement, rect: NormalizedRect) => {
  const sourceWidth = Math.max(1, Math.round(rect.width * source.width))
  const sourceHeight = Math.max(1, Math.round(rect.height * source.height))
  const sourceLeft = Math.max(0, Math.min(source.width - sourceWidth, Math.round(rect.x * source.width)))
  const sourceTop = Math.max(0, Math.min(source.height - sourceHeight, Math.round(rect.y * source.height)))
  const crop = document.createElement('canvas')
  crop.width = sourceWidth
  crop.height = sourceHeight
  const cropContext = crop.getContext('2d', { willReadFrequently: true })
  if (!cropContext) throw new Error('无法创建装备模型裁片')
  cropContext.drawImage(source, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
  const fill = averageColor(cropContext.getImageData(0, 0, sourceWidth, sourceHeight).data)

  const normalized = document.createElement('canvas')
  normalized.width = EQUIPMENT_MODEL_SIZE
  normalized.height = EQUIPMENT_MODEL_SIZE
  const context = normalized.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建装备模型输入')
  context.fillStyle = `rgb(${fill.join(',')})`
  context.fillRect(0, 0, EQUIPMENT_MODEL_SIZE, EQUIPMENT_MODEL_SIZE)
  const scale = Math.min(EQUIPMENT_MODEL_SIZE / sourceWidth, EQUIPMENT_MODEL_SIZE / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  context.drawImage(crop, 0, 0, sourceWidth, sourceHeight,
    Math.floor((EQUIPMENT_MODEL_SIZE - width) / 2), Math.floor((EQUIPMENT_MODEL_SIZE - height) / 2), width, height)
  const data = context.getImageData(0, 0, EQUIPMENT_MODEL_SIZE, EQUIPMENT_MODEL_SIZE).data
  const plane = EQUIPMENT_MODEL_SIZE * EQUIPMENT_MODEL_SIZE
  const tensor = new Float32Array(plane * 3)
  for (let index = 0; index < plane; index += 1) {
    tensor[index] = data[index * 4] / 255
    tensor[plane + index] = data[index * 4 + 1] / 255
    tensor[plane * 2 + index] = data[index * 4 + 2] / 255
  }
  return tensor
}

export const constrainEquipmentProbabilities = (
  probabilities: readonly number[], manifest: EquipmentModelManifest, limit = 8,
): RankedVisualCandidate[] => {
  if (probabilities.length !== manifest.classCount || manifest.classes.length !== manifest.classCount
    || probabilities.some((value) => !Number.isFinite(value))) throw new Error('装备模型输出形状或数值无效')
  const total = probabilities.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (!(total > 0)) throw new Error('装备模型输出概率和无效')
  return manifest.classes.map((item) => ({
    id: item.equipmentId,
    score: Math.max(0, probabilities[item.modelIndex]) / total,
    source: 'onnx' as const,
  })).sort((left, right) => right.score - left.score).slice(0, limit)
}

export const classifyEquipment = async (source: HTMLCanvasElement, rect: NormalizedRect, limit = 8) => {
  const tensor = normalizeEquipmentCrop(source, rect)
  const result = await runEquipmentClassifier(tensor)
  return {
    candidates: constrainEquipmentProbabilities(result.values, result.manifest, limit),
    manifest: result.manifest,
    inputRect: rect,
  }
}
