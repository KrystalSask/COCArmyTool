import type { DetectedCardSlot, PixelBuffer } from './cardDetector'

export const ARMY_CARD_SIZE = 160
export const ARMY_CARD_FILL: [number, number, number] = [57, 64, 71]

export const rgbImageToChw = (pixels: Uint8ClampedArray, width: number, height: number) => {
  const plane = width * height
  const output = new Float32Array(plane * 3)
  for (let index = 0; index < plane; index += 1) {
    output[index] = pixels[index * 4] / 255
    output[plane + index] = pixels[index * 4 + 1] / 255
    output[plane * 2 + index] = pixels[index * 4 + 2] / 255
  }
  return output
}

export const normalizeArmyCardCrop = (image: PixelBuffer, slot: DetectedCardSlot) => {
  const sourceLeft = Math.max(0, Math.round(slot.rect.x * image.width))
  const sourceTop = Math.max(0, Math.round(slot.rect.y * image.height))
  const sourceWidth = Math.max(1, Math.min(image.width - sourceLeft, Math.round(slot.rect.width * image.width)))
  const sourceHeight = Math.max(1, Math.min(image.height - sourceTop, Math.round(slot.rect.height * image.height)))
  const scaledWidth = Math.round(sourceWidth / sourceHeight * ARMY_CARD_SIZE)
  const drawWidth = Math.min(ARMY_CARD_SIZE, scaledWidth)
  const canvas = document.createElement('canvas')
  canvas.width = ARMY_CARD_SIZE
  canvas.height = ARMY_CARD_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建单卡标准化画布')
  context.fillStyle = `rgb(${ARMY_CARD_FILL.join(',')})`
  context.fillRect(0, 0, ARMY_CARD_SIZE, ARMY_CARD_SIZE)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.width
  sourceCanvas.height = image.height
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) throw new Error('无法创建单卡源画布')
  sourceContext.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  context.drawImage(sourceCanvas, sourceLeft, sourceTop, Math.min(sourceWidth, sourceHeight), sourceHeight, 0, 0, drawWidth, ARMY_CARD_SIZE)
  return rgbImageToChw(context.getImageData(0, 0, ARMY_CARD_SIZE, ARMY_CARD_SIZE).data, ARMY_CARD_SIZE, ARMY_CARD_SIZE)
}
