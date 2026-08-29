import pkg from '../../package.json'
import type { ArmyComposition } from '../domain/types'
import { db, type ArmyDatabase } from '../storage/armyDatabase'
import { compositionFromRecognition } from './review'
import { SAMPLE_ENDPOINT, SAMPLE_UPLOAD_TOKEN } from './sampleEndpoint'
import type { ScreenshotPreflight, ScreenshotRecognitionResult } from './types'
import { isTauri } from '../utils/platform'

// 图像上传策略：≤4.2MB 直接原样上传（服务端 6MB 请求体 ÷ base64 膨胀
// 1.33 留余量）；超限先按原分辨率重编码 JPEG q0.95（不缩尺寸），仍超限
// 才缩到最长边 1920px。sha256 始终取原始文件，不受编码影响。
const MAX_DIRECT_UPLOAD_BYTES = 4.2 * 1024 * 1024
const MAX_IMAGE_EDGE = 1920
const REENCODE_JPEG_QUALITY = .95

// 桌面端（Tauri）整体关闭样本采集：不上传、不显示任何收集相关 UI。
export const isSampleCollectionSupported = (): boolean => !isTauri()

// 自动化会话（Playwright 等 webdriver 环境）绝不采集，避免回归测试把
// 批量样本灌进线上样本库；人工使用时该标志不会为真。
export const isAutomatedSession = (): boolean =>
  typeof navigator !== 'undefined' && navigator.webdriver === true

// preflight 里的 viewportPixels 是 ImageData，只用于本机面板定位，
// 不能也不需要进入样本。
type PreflightSummary = Omit<ScreenshotPreflight, 'viewportPixels'>

const summarizePreflight = (preflight: ScreenshotPreflight): PreflightSummary => {
  const { viewportPixels: _viewportPixels, ...summary } = preflight
  return summary
}

export interface SampleMeta {
  appVersion: string
  engine: ScreenshotRecognitionResult['engine']
  collectedAt: string
  hadCorrections: boolean
  unresolvedCountAtEntry: number
  preflight: PreflightSummary
  machineResult: ScreenshotRecognitionResult
  finalComposition: ArmyComposition
  // 仅在“一键确认全部 + 容量校验通过”的路径上携带；跳过确认或容量
  // 不通过时样本照常回传，但不含配兵链接。
  armyLink?: string
}

export interface SampleCaptureInput {
  file: File
  preflight: ScreenshotPreflight
  // 机器原始输出快照：生成候选时克隆，先于任何人工确认修改。
  machineResult: ScreenshotRecognitionResult
  finalComposition: ArmyComposition
  unresolvedCountAtEntry: number
  armyLink?: string
}

// 键序无关的稳定序列化：composition 两端的字段顺序不保证一致，
// 不能直接用 JSON.stringify 做等值比较。
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sameComposition = (left: ArmyComposition, right: ArmyComposition) => stableStringify(left) === stableStringify(right)

export const buildSampleMeta = (input: Omit<SampleCaptureInput, 'file'>): SampleMeta => ({
  appVersion: pkg.version,
  engine: input.machineResult.engine,
  collectedAt: new Date().toISOString(),
  hadCorrections: !sameComposition(input.finalComposition, compositionFromRecognition(input.machineResult)),
  unresolvedCountAtEntry: input.unresolvedCountAtEntry,
  preflight: summarizePreflight(input.preflight),
  machineResult: input.machineResult,
  finalComposition: input.finalComposition,
  ...(input.armyLink === undefined ? {} : { armyLink: input.armyLink }),
})

const readFileAsBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result)
    resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
  }
  reader.onerror = () => reject(new Error('读取图片失败'))
  reader.readAsDataURL(blob)
})

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality))

// 原分辨率重编码为 JPEG：尺寸不变、只压体积，尽量保住原图信息。
const reencodeAtOriginalSize = async (file: Blob): Promise<Blob> => {
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await canvasToBlob(canvas, 'image/jpeg', REENCODE_JPEG_QUALITY)
    return blob ?? file
  } catch {
    return file
  }
}

const shrinkImage = async (file: Blob): Promise<Blob> => {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const shrunk = await canvasToBlob(canvas, 'image/png')
    return shrunk && shrunk.size < file.size ? shrunk : file
  } catch {
    return file
  }
}

export interface EncodedSampleImage {
  imageBase64: string
  imageType: string
}

export const encodeSampleImage = async (file: File): Promise<EncodedSampleImage> => {
  let blob: Blob = file
  if (blob.size > MAX_DIRECT_UPLOAD_BYTES) {
    const reencoded = await reencodeAtOriginalSize(blob)
    if (reencoded.size < blob.size) blob = reencoded
  }
  if (blob.size > MAX_DIRECT_UPLOAD_BYTES) {
    const shrunk = await shrinkImage(blob)
    if (shrunk.size < blob.size) blob = shrunk
  }
  return {
    imageBase64: await readFileAsBase64(blob),
    imageType: blob.type || file.type || 'image/png',
  }
}

export interface SampleQueueRow {
  sha256: string
  createdAt: string
  status: 'pending' | 'uploaded'
  attempts: number
  lastError?: string
  imageBase64: string
  imageType: string
  payload: SampleMeta
}

export const enqueueSample = async (input: SampleCaptureInput, database: ArmyDatabase = db): Promise<'enqueued' | 'duplicate'> => {
  const existing = await database.sampleQueue.get(input.preflight.sha256)
  if (existing) return 'duplicate'
  const image = await encodeSampleImage(input.file)
  const row: SampleQueueRow = {
    sha256: input.preflight.sha256,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    imageType: image.imageType,
    imageBase64: image.imageBase64,
    payload: buildSampleMeta(input),
  }
  await database.sampleQueue.put(row)
  return 'enqueued'
}

export interface SampleQueueSummary {
  pending: number
  uploaded: number
}

export const getSampleQueueSummary = async (database: ArmyDatabase = db): Promise<SampleQueueSummary> => {
  const rows = await database.sampleQueue.toArray()
  return {
    pending: rows.filter((row) => row.status === 'pending').length,
    uploaded: rows.filter((row) => row.status === 'uploaded').length,
  }
}

const uploadRow = async (row: SampleQueueRow): Promise<void> => {
  const response = await fetch(`${SAMPLE_ENDPOINT}/sample`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-upload-token': SAMPLE_UPLOAD_TOKEN },
    body: JSON.stringify({
      sha256: row.sha256,
      imageBase64: row.imageBase64,
      imageType: row.imageType,
      sample: row.payload,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export interface FlushResult {
  uploaded: number
  failed: number
  remaining: number
}

// 逐条上传待传样本；失败仅累加尝试次数和错误信息，等待下次重试。
export const flushSampleQueue = async (limit = 3, database: ArmyDatabase = db): Promise<FlushResult> => {
  const pending = await database.sampleQueue.where('status').equals('pending').limit(limit).toArray()
  let uploaded = 0
  let failed = 0
  for (const row of pending) {
    try {
      await uploadRow(row)
      await database.sampleQueue.update(row.sha256, { status: 'uploaded', lastError: undefined })
      uploaded += 1
    } catch (reason) {
      failed += 1
      await database.sampleQueue.update(row.sha256, {
        attempts: row.attempts + 1,
        lastError: reason instanceof Error ? reason.message : String(reason),
      })
    }
  }
  const summary = await getSampleQueueSummary(database)
  return { uploaded, failed, remaining: summary.pending }
}

// 唯一采集入口：桌面端与自动化会话直接返回；mock 引擎不采集。
// 入队后立即尝试上传；入队或上传失败不打断用户流程，样本留在队列里
// 等下次重试。
export const collectSample = (input: SampleCaptureInput): void => {
  if (!isSampleCollectionSupported() || isAutomatedSession()) return
  if (input.machineResult.engine === 'mock') return
  void enqueueSample(input).then((outcome) => {
    if (outcome === 'enqueued') return flushSampleQueue()
    return undefined
  }).catch(() => {
    // 静默失败：不打断识别主流程。
  })
}
