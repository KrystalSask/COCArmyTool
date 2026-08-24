import type { RecognitionLayout, ScreenshotPreflight } from './types'
import { locatePanelFromPixels, refinePanelFromPixels, selectPanelProfile } from './panelLocator'
import { MAX_INPUT_PIXELS } from './imageNormalization'

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
  if (aspectRatio < 1.3 || aspectRatio > 2.4) issues.push('未检测到完整横屏画面，请上传未裁剪的游戏截图')
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
  panel: ReturnType<typeof selectPanelProfile>
}

const inspectPixels = (image: HTMLImageElement, panelOverride?: ScreenshotPreflight['panel']): PixelStats => {
  const width = 512
  const height = Math.max(220, Math.round(width / (image.naturalWidth / image.naturalHeight)))
  const profilePanel = selectPanelProfile(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { layout: 'unknown', layoutConfidence: 0, woodPixelRatio: 0, panel: profilePanel }
  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  const searchedPanel = locatePanelFromPixels(imageData, profilePanel)
  const edgeDarkRatio = (top: number, bottom: number) => {
    let dark = 0
    let total = 0
    for (let y = Math.round(height * top); y < Math.round(height * bottom); y += 2) for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4
      total += 1
      if (imageData.data[offset] < 20 && imageData.data[offset + 1] < 20 && imageData.data[offset + 2] < 20) dark += 1
    }
    return total ? dark / total : 0
  }
  const videoCanvas = edgeDarkRatio(0, .12) > .88 || edgeDarkRatio(.87, 1) > .88
  const coarsePanel = panelOverride
    ? { deviceProfile: 'generic-landscape' as const, panel: panelOverride, confidence: 1, source: 'manual' as const }
    : videoCanvas && searchedPanel.source === 'automatic' ? searchedPanel
      : profilePanel.deviceProfile !== 'generic-landscape' && profilePanel.deviceProfile !== 'unknown'
        ? { ...profilePanel, source: 'profile' as const }
      : searchedPanel.source === 'automatic'
      ? (() => {
          const profile = profilePanel.panel
          const found = searchedPanel.panel
          const closeToProfile = Math.abs(profile.x - found.x) < .035 && Math.abs(profile.y - found.y) < .045
            && Math.abs(profile.width - found.width) < .05 && Math.abs(profile.height - found.height) < .06
          return closeToProfile ? { ...profilePanel, source: 'profile' as const } : searchedPanel
        })()
      : { ...profilePanel, source: 'profile' as const }
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
  const panel = coarsePanel.source === 'automatic' ? coarsePanel : refinePanelFromPixels(imageData, coarsePanel)
  const layoutConfidence = layout === 'attack'
    ? Math.min(.98, .62 + (attackButtonRatio - .5) * 1.8)
    : Math.min(.98, .62 + Math.abs(greenRatio - .06) * 2.5)
  return { layout, layoutConfidence, woodPixelRatio, panel }
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
    deviceProfile: pixelStats.panel.deviceProfile,
    panel: pixelStats.panel.panel,
    panelConfidence: pixelStats.panel.confidence,
    panelSource: pixelStats.panel.source ?? 'profile',
    woodPixelRatio: pixelStats.woodPixelRatio,
    complete: issues.length === 0,
    issues,
  }
}
