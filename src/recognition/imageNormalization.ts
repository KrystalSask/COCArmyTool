import type { NormalizedRect } from './types'

export const STANDARD_PANEL_WIDTH = 2160
export const STANDARD_PANEL_HEIGHT = 1120
export const MAX_INPUT_PIXELS = 40_000_000

export interface StandardRecognitionImage {
  canvas: HTMLCanvasElement
  pixels: ImageData
  sourceWidth: number
  sourceHeight: number
  sourcePanel: NormalizedRect
}

export const pixelBounds = (rect: NormalizedRect, width: number, height: number) => {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)))
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)))
  const right = Math.max(left + 1, Math.min(width, Math.round((rect.x + rect.width) * width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round((rect.y + rect.height) * height)))
  return { left, top, width: right - left, height: bottom - top }
}

export const createStandardRecognitionImage = (image: CanvasImageSource, sourceWidth: number, sourceHeight: number, panel: NormalizedRect): StandardRecognitionImage => {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('图片尺寸无效。')
  if (sourceWidth * sourceHeight > MAX_INPUT_PIXELS) throw new Error('图片像素总量过大，请使用不超过 4000 万像素的完整截图。')
  const bounds = pixelBounds(panel, sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = STANDARD_PANEL_WIDTH
  canvas.height = STANDARD_PANEL_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建标准识别画布。')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height)
  return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height), sourceWidth, sourceHeight, sourcePanel: { ...panel } }
}
