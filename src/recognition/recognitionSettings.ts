export interface RecognitionSettings {
  cardClassifier: 'onnx' | 'template'
  countRecognizer: 'ppocrv6' | 'bitmap'
  equipmentClassifier: 'onnx' | 'shadow' | 'template'
  ruleApplication: 'warn-only' | 'legacy-auto-correct'
}

export const recognitionSettings: RecognitionSettings = {
  cardClassifier: 'onnx',
  countRecognizer: 'ppocrv6',
  equipmentClassifier: 'onnx',
  ruleApplication: 'warn-only',
}
