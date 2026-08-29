/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import { EQUIPMENT_MODEL_FILES, MODEL_FILES, modelAssetUrl, type EquipmentModelManifest } from './modelManifest'

type Request =
  | { id: number, type: 'warmup' }
  | { id: number, type: 'classify', data: Float32Array }
  | { id: number, type: 'ocr', data: Float32Array, width: number }
  | { id: number, type: 'equipment', data: Float32Array }

const worker = self as unknown as DedicatedWorkerGlobalScope
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm: wasmUrl }

let classifierPromise: Promise<ort.InferenceSession> | undefined
let ocrPromise: Promise<ort.InferenceSession> | undefined
let equipmentPromise: Promise<{ session: ort.InferenceSession, manifest: EquipmentModelManifest }> | undefined

const classifier = () => classifierPromise ??= ort.InferenceSession.create(modelAssetUrl(MODEL_FILES.classifier), { executionProviders: ['wasm'] })
const ocr = () => ocrPromise ??= ort.InferenceSession.create(modelAssetUrl(MODEL_FILES.ocr), { executionProviders: ['wasm'] })

const equipment = () => equipmentPromise ??= (async () => {
  const response = await fetch(modelAssetUrl(EQUIPMENT_MODEL_FILES.manifest), { cache: 'no-cache' })
  if (!response.ok) throw new Error(`装备模型 manifest 加载失败: ${response.status}`)
  const manifest = await response.json() as EquipmentModelManifest
  if (manifest.schemaVersion !== 1 || manifest.classCount !== 42
    || manifest.input.name !== 'images' || manifest.input.width !== 96 || manifest.input.height !== 96
    || manifest.input.layout !== 'NCHW' || manifest.input.color !== 'RGB'
    || manifest.input.normalization !== 'divide-255' || manifest.output.name !== 'output0'
    || manifest.output.kind !== 'probabilities' || manifest.output.shape[0] !== 1 || manifest.output.shape[1] !== manifest.classCount
    || manifest.classes.length !== manifest.classCount
    || manifest.classes.some((item, index) => item.modelIndex !== index || !Number.isInteger(item.equipmentId) || !Number.isInteger(item.ownerHeroId))) {
    throw new Error('装备模型 manifest 与输入输出契约不一致')
  }
  const session = await ort.InferenceSession.create(modelAssetUrl(manifest.modelFile), { executionProviders: ['wasm'] })
  const input = session.inputNames.length === 1 ? session.inputMetadata[0] : undefined
  const output = session.outputNames.length === 1 ? session.outputMetadata[0] : undefined
  const inputDimensions = input && 'shape' in input ? Array.from(input.shape as readonly unknown[]).map(String).join(',') : undefined
  const outputDimensions = output && 'shape' in output ? Array.from(output.shape as readonly unknown[]).map(String).join(',') : undefined
  if (session.inputNames[0] !== manifest.input.name || session.outputNames[0] !== manifest.output.name
    || (inputDimensions !== undefined && inputDimensions !== '1,3,96,96')
    || (outputDimensions !== undefined && outputDimensions !== '1,42')) {
    throw new Error('装备模型实际输入输出与 manifest 不一致')
  }
  return { session, manifest }
})()

worker.onmessage = async ({ data: request }: MessageEvent<Request>) => {
  try {
    if (request.type === 'warmup') {
      // 后台预热：提前完成三个模型的下载与推理会话初始化，
      // 让用户上传截图后无需再等首次加载。
      await Promise.all([classifier(), ocr(), equipment()])
      worker.postMessage({ id: request.id, warmed: true })
    } else if (request.type === 'classify') {
      const session = await classifier()
      const result = await session.run({ images: new ort.Tensor('float32', request.data, [1, 3, 160, 160]) })
      worker.postMessage({ id: request.id, values: Array.from(result.output0.data as Float32Array) })
    } else if (request.type === 'ocr') {
      const session = await ocr()
      const result = await session.run({ x: new ort.Tensor('float32', request.data, [1, 3, 48, request.width]) })
      const output = result.fetch_name_0
      worker.postMessage({ id: request.id, values: Array.from(output.data as Float32Array), dims: output.dims })
    } else {
      const loaded = await equipment()
      const result = await loaded.session.run({ [loaded.manifest.input.name]: new ort.Tensor('float32', request.data, [1, 3, 96, 96]) })
      const output = result[loaded.manifest.output.name]
      if (!output || !('data' in output)) throw new Error('装备模型没有有效输出')
      worker.postMessage({ id: request.id, values: Array.from(output.data as Float32Array), manifest: loaded.manifest })
    }
  } catch (error) {
    worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  }
}
