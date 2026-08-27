/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import { MODEL_FILES, modelAssetUrl } from './modelManifest'

type Request =
  | { id: number, type: 'classify', data: Float32Array }
  | { id: number, type: 'ocr', data: Float32Array, width: number }

const worker = self as unknown as DedicatedWorkerGlobalScope
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm: wasmUrl }

let classifierPromise: Promise<ort.InferenceSession> | undefined
let ocrPromise: Promise<ort.InferenceSession> | undefined

const classifier = () => classifierPromise ??= ort.InferenceSession.create(modelAssetUrl(MODEL_FILES.classifier), { executionProviders: ['wasm'] })
const ocr = () => ocrPromise ??= ort.InferenceSession.create(modelAssetUrl(MODEL_FILES.ocr), { executionProviders: ['wasm'] })

worker.onmessage = async ({ data: request }: MessageEvent<Request>) => {
  try {
    if (request.type === 'classify') {
      const session = await classifier()
      const result = await session.run({ images: new ort.Tensor('float32', request.data, [1, 3, 160, 160]) })
      worker.postMessage({ id: request.id, values: Array.from(result.output0.data as Float32Array) })
    } else {
      const session = await ocr()
      const result = await session.run({ x: new ort.Tensor('float32', request.data, [1, 3, 48, request.width]) })
      const output = result.fetch_name_0
      worker.postMessage({ id: request.id, values: Array.from(output.data as Float32Array), dims: output.dims })
    }
  } catch (error) {
    worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  }
}
