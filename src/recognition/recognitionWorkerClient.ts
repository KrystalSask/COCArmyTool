import type { EquipmentModelManifest } from './modelManifest'

type WorkerResponse = { id: number, values?: number[], dims?: readonly number[], manifest?: EquipmentModelManifest, error?: string }

let worker: Worker | undefined
let nextId = 1
const pending = new Map<number, { resolve: (value: WorkerResponse) => void, reject: (error: Error) => void, timer: number }>()

const getWorker = () => {
  if (worker) return worker
  worker = new Worker(new URL('./recognitionWorker.ts', import.meta.url), { type: 'module', name: 'army-recognition' })
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const request = pending.get(data.id)
    if (!request) return
    window.clearTimeout(request.timer)
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data)
  }
  worker.onerror = (event) => {
    for (const request of pending.values()) request.reject(new Error(event.message || '识别 Worker 失败'))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

const request = (message: Omit<Record<string, unknown>, 'id'>) => new Promise<WorkerResponse>((resolve, reject) => {
  const id = nextId++
  const timer = window.setTimeout(() => {
    pending.delete(id)
    reject(new Error('识别模型推理超时'))
  }, 60_000)
  pending.set(id, { resolve, reject, timer })
  getWorker().postMessage({ ...message, id })
})

export const runArmyCardClassifier = async (data: Float32Array) => {
  const response = await request({ type: 'classify', data })
  return response.values ?? []
}

export const runArmyCountOcr = async (data: Float32Array, width: number) => {
  const response = await request({ type: 'ocr', data, width })
  return { values: response.values ?? [], dims: response.dims ?? [] }
}

export const runEquipmentClassifier = async (data: Float32Array) => {
  const response = await request({ type: 'equipment', data })
  if (!response.manifest) throw new Error('装备模型未返回 manifest')
  return { values: response.values ?? [], manifest: response.manifest }
}
