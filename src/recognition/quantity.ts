import type { CountCandidate, NormalizedRect } from './types'

export const QUANTITY_ALPHABET = ['x', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export interface QuantityRecognitionInput {
  image: ImageData
  cardRect: NormalizedRect
}

export interface QuantityRecognitionOutput {
  status: 'recognized' | 'uncertain' | 'pending'
  candidates: CountCandidate[]
  crop?: ImageData
}

export interface QuantityRecognizer {
  readonly id: string
  recognize(input: QuantityRecognitionInput): Promise<QuantityRecognitionOutput>
}

export const pendingQuantityRecognizer: QuantityRecognizer = {
  id: 'pending-template-recognizer',
  async recognize() {
    return { status: 'pending', candidates: [] }
  },
}

export const normalizeCountCandidates = (candidates: CountCandidate[]) => candidates
  .filter((candidate) => Number.isInteger(candidate.value) && candidate.value > 0 && Number.isFinite(candidate.score))
  .sort((left, right) => right.score - left.score)
  .slice(0, 3)
