export interface RecognitionSettings {
  cardClassifier: 'onnx' | 'template'
  countRecognizer: 'ppocrv6' | 'bitmap'
  ruleApplication: 'warn-only' | 'legacy-auto-correct'
}

export const recognitionSettings: RecognitionSettings = {
  cardClassifier: 'onnx',
  countRecognizer: 'ppocrv6',
  ruleApplication: 'warn-only',
}
