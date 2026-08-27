export interface ArmyCardClassDefinition {
  index: number
  className: string
  kind: 'troop' | 'spell' | 'siege'
  id: number
}

export const modelAssetUrl = (file: string) => `${import.meta.env.BASE_URL}models/${file}`

export const MODEL_FILES = {
  classifier: 'army-card-classifier-cn-v2.onnx',
  classes: 'army-card-classes-cn-v2.json',
  ocr: 'army-count-ocr-ppocrv6-small-v1.onnx',
  charset: 'army-count-ocr-charset-v1.json',
} as const
