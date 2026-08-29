export interface ArmyCardClassDefinition {
  index: number
  className: string
  kind: 'troop' | 'spell' | 'siege'
  id: number
}

export interface EquipmentModelClassDefinition {
  modelIndex: number
  className: string
  equipmentId: number
  ownerHeroId: number
}

export interface EquipmentModelManifest {
  schemaVersion: number
  modelId: string
  modelVersion: string
  modelFile: string
  classesFile: string
  classCount: number
  input: {
    name: string
    width: number
    height: number
    layout: 'NCHW'
    color: 'RGB'
    normalization: 'divide-255'
    resize: 'letterbox-edge-color'
  }
  output: { name: string, kind: 'probabilities', shape: [number, number] }
  preprocessingVersion: string
  classes: EquipmentModelClassDefinition[]
  evaluation?: {
    realReferenceMissingEquipmentIds?: number[]
  }
}

export const modelAssetUrl = (file: string) => `${import.meta.env.BASE_URL}models/${file}`

export const MODEL_FILES = {
  classifier: 'army-card-classifier-cn-v2.onnx',
  classes: 'army-card-classes-cn-v2.json',
  ocr: 'army-count-ocr-ppocrv6-small-v1.onnx',
  charset: 'army-count-ocr-charset-v1.json',
} as const

export const EQUIPMENT_MODEL_FILES = {
  model: 'equipment-classifier-v1.onnx',
  classes: 'equipment-classifier-v1-classes.json',
  manifest: 'equipment-classifier-v1-manifest.json',
} as const
