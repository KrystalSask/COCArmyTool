import type { PanelCandidateDiagnostic, RecognitionLayout, ScreenshotPreflight } from './types'
import { createPanelFallback, locatePanelCandidatesFromPixels, type LocatedPanel } from './panelLocator'
import { registerPanelCandidates } from './panelRegistration'
import { MAX_INPUT_PIXELS } from './imageNormalization'
import { cropImageData, locateGameViewport, projectRectFromViewport } from './viewportLocator'

export interface DimensionInspection {
  complete: boolean
  aspectRatio: number
  issues: string[]
}

export const inspectDimensions = (width: number, height: number, mimeType: string): DimensionInspection => {
  const issues: string[] = []
  const aspectRatio = height > 0 ? width / height : 0
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) issues.push('仅支持 PNG、JPG 或 WebP 图片')
  if (width < 1000 || height < 500) issues.push('图片分辨率过低，请上传原始完整截图')
  if (width * height > MAX_INPUT_PIXELS) issues.push('图片像素总量过大，请使用不超过 4000 万像素的完整截图')
  return { complete: issues.length === 0, aspectRatio, issues }
}

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    URL.revokeObjectURL(url)
    resolve(image)
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    reject(new Error('图片无法读取或已经损坏'))
  }
  image.src = url
})

const hashFile = async (file: File) => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

interface PixelStats {
  layout: RecognitionLayout
  layoutConfidence: number
  woodPixelRatio: number
  panel: LocatedPanel
  gameViewport: ScreenshotPreflight['gameViewport']
  viewportConfidence: number
  viewportPixels: ImageData
}

const inspectPixels = (image: HTMLImageElement, panelOverride?: ScreenshotPreflight['panel']): PixelStats => {
  const width = 512
  const height = Math.max(220, Math.round(width / (image.naturalWidth / image.naturalHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return {
    layout: 'unknown', layoutConfidence: 0, woodPixelRatio: 0,
    panel: createPanelFallback(), gameViewport: { x: 0, y: 0, width: 1, height: 1 }, viewportConfidence: 0,
    viewportPixels: { width: 0, height: 0, data: new Uint8ClampedArray(0), colorSpace: 'srgb' } as ImageData,
  }
  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  const viewport = locateGameViewport(imageData)
  const viewportPixels = cropImageData(imageData, viewport.rect)
  const manualInViewport = panelOverride ? {
    x: (panelOverride.x - viewport.rect.x) / viewport.rect.width,
    y: (panelOverride.y - viewport.rect.y) / viewport.rect.height,
    width: panelOverride.width / viewport.rect.width,
    height: panelOverride.height / viewport.rect.height,
  } : undefined
  const coarseCandidates = locatePanelCandidatesFromPixels(viewportPixels, createPanelFallback(), manualInViewport)
  // 提交的手动面板直接作为生产候选：跳过全分辨率内部注册，避免注册候选
  // 替换或移动用户矩形。自动路径保留现有注册行为。
  let registeredCandidates: PanelCandidateDiagnostic[] = []
  if (!manualInViewport) {
    const registrationWidth = Math.min(1536, image.naturalWidth)
    const registrationHeight = Math.max(320, Math.round(registrationWidth / (image.naturalWidth / image.naturalHeight)))
    const registrationCanvas = document.createElement('canvas')
    registrationCanvas.width = registrationWidth
    registrationCanvas.height = registrationHeight
    const registrationContext = registrationCanvas.getContext('2d', { willReadFrequently: true })
    registrationContext?.drawImage(image, 0, 0, registrationWidth, registrationHeight)
    const registrationFullPixels = registrationContext?.getImageData(0, 0, registrationWidth, registrationHeight)
    const registrationPixels = registrationFullPixels ? cropImageData(registrationFullPixels, viewport.rect) : viewportPixels
    registeredCandidates = registerPanelCandidates(registrationPixels, coarseCandidates, 5)
  }
  // Registration remains in shadow mode until card/hero structure scores join
  // the selector. Internal edges alone can prefer a strong card edge, so the
  // legacy refined seed remains the production choice during this phase.
  const legacySelected = coarseCandidates[0]
  const selectedInViewport: LocatedPanel = {
    panel: legacySelected.panel,
    confidence: legacySelected.geometryScore,
    source: panelOverride ? 'manual' : legacySelected.source === 'fallback' ? 'fallback' : 'automatic',
  }
  const panel: LocatedPanel = {
    ...selectedInViewport,
    panel: projectRectFromViewport(selectedInViewport.panel, viewport.rect),
  }
  const coarsePanel = panel
  const pixels = imageData.data

  let wood = 0
  let woodTotal = 0
  let green = 0
  let greenTotal = 0
  let attackButton = 0
  let attackButtonTotal = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const red = pixels[offset]
      const greenValue = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const panelX = (x / width - coarsePanel.panel.x) / coarsePanel.panel.width
      const panelY = (y / height - coarsePanel.panel.y) / coarsePanel.panel.height
      if (panelX > .02 && panelX < .98 && panelY > .10 && panelY < .94) {
        woodTotal += 1
        if (red > 70 && red < 205 && red > greenValue * 1.08 && greenValue > blue * 1.03) wood += 1
      }
      if (panelX > .005 && panelX < .16 && panelY > .005 && panelY < .12) {
        greenTotal += 1
        if (greenValue > 100 && greenValue > red * 1.12 && greenValue > blue * 1.18) green += 1
      }
      if (panelX > .80 && panelX < .98 && panelY > .88 && panelY < .97) {
        attackButtonTotal += 1
        if (red > 140 && greenValue > 110 && blue > 90 && red - blue < 100) attackButton += 1
      }
    }
  }
  const greenRatio = greenTotal ? green / greenTotal : 0
  const attackButtonRatio = attackButtonTotal ? attackButton / attackButtonTotal : 0
  const woodPixelRatio = woodTotal ? wood / woodTotal : 0
  const layout: RecognitionLayout = attackButtonRatio > .5 ? 'attack' : greenRatio > .06 ? 'edit' : 'saved'
  const layoutConfidence = layout === 'attack'
    ? Math.min(.98, .62 + (attackButtonRatio - .5) * 1.8)
    : Math.min(.98, .62 + Math.abs(greenRatio - .06) * 2.5)
  Object.assign(panel, {
    candidates: registeredCandidates.map((candidate) => ({
      ...candidate,
      panel: projectRectFromViewport(candidate.panel, viewport.rect),
      anchorEvidence: candidate.anchorEvidence.map((evidence) => ({ ...evidence, rect: projectRectFromViewport(evidence.rect, viewport.rect) })),
    })),
  })
  return { layout, layoutConfidence, woodPixelRatio, panel, gameViewport: viewport.rect, viewportConfidence: viewport.confidence, viewportPixels }
}

export const inspectScreenshotFile = async (file: File, panelOverride?: ScreenshotPreflight['panel']): Promise<ScreenshotPreflight> => {
  const image = await loadImage(file)
  const dimensions = inspectDimensions(image.naturalWidth, image.naturalHeight, file.type)
  const pixelStats = inspectPixels(image, panelOverride)
  const issues = [...dimensions.issues]
  if (pixelStats.woodPixelRatio < .18) issues.push('未检测到完整军队配置面板，请上传包含全部英雄和军队区域的截图')
  if (pixelStats.layout === 'unknown') issues.push('无法判断截图所属的军队配置页面')
  return {
    fileName: file.name,
    mimeType: file.type,
    width: image.naturalWidth,
    height: image.naturalHeight,
    aspectRatio: dimensions.aspectRatio,
    sha256: await hashFile(file),
    layout: pixelStats.layout,
    layoutConfidence: pixelStats.layoutConfidence,
    gameViewport: pixelStats.gameViewport,
    viewportConfidence: pixelStats.viewportConfidence,
    panel: pixelStats.panel.panel,
    panelConfidence: pixelStats.panel.confidence,
    panelSource: pixelStats.panel.source ?? 'fallback',
    panelCandidates: (pixelStats.panel as LocatedPanel & { candidates?: ScreenshotPreflight['panelCandidates'] }).candidates,
    panelSelectionGap: (() => {
      const candidates = (pixelStats.panel as LocatedPanel & { candidates?: ScreenshotPreflight['panelCandidates'] }).candidates
      return candidates && candidates.length > 1 ? candidates[0].geometryScore - candidates[1].geometryScore : undefined
    })(),
    woodPixelRatio: pixelStats.woodPixelRatio,
    viewportPixels: pixelStats.viewportPixels,
    complete: issues.length === 0,
    issues,
  }
}
