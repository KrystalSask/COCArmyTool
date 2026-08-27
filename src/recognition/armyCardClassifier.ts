import type { CardClassCandidate } from './cardDetector'
import type { RecognitionRegionKind } from './types'
import { MODEL_FILES, modelAssetUrl, type ArmyCardClassDefinition } from './modelManifest'
import { runArmyCardClassifier } from './recognitionWorkerClient'

let classesPromise: Promise<ArmyCardClassDefinition[]> | undefined
const classes = () => classesPromise ??= fetch(modelAssetUrl(MODEL_FILES.classes)).then(async (response) => {
  if (!response.ok) throw new Error(`类别映射加载失败: ${response.status}`)
  const value = await response.json() as ArmyCardClassDefinition[]
  if (value.length !== 76 || value.some((item, index) => item.index !== index)) throw new Error('类别映射不是有效的 76 类模型顺序')
  return value
})

export const allowedKindsForRegion = (region: Exclude<RecognitionRegionKind, 'heroes'>) => region === 'mainTroops'
  ? ['troop'] as const
  : region === 'mainSpells' ? ['spell'] as const
    : region === 'mainSiege' ? ['siege'] as const : ['troop', 'spell', 'siege'] as const

export const constrainClassProbabilitiesByRegion = (
  probabilities: readonly number[], definitions: readonly ArmyCardClassDefinition[],
  region: Exclude<RecognitionRegionKind, 'heroes'>, limit: number,
): CardClassCandidate[] => {
  if (probabilities.length !== 76 || definitions.length !== 76 || probabilities.some((value) => !Number.isFinite(value))) {
    throw new Error('分类模型输出形状或数值无效')
  }
  const allowed = new Set<string>(allowedKindsForRegion(region))
  const allowedMass = definitions.reduce((sum, definition) => allowed.has(definition.kind) ? sum + Math.max(0, probabilities[definition.index]) : sum, 0)
  if (!(allowedMass > 0)) throw new Error('区域允许类别的概率和无效')
  return definitions.filter((definition) => allowed.has(definition.kind)).map((definition) => ({
    id: definition.id,
    kind: definition.kind,
    rawScore: probabilities[definition.index],
    score: Math.max(0, probabilities[definition.index]) / allowedMass,
  })).sort((left, right) => right.score - left.score).slice(0, limit)
}

export const classifyArmyCard = async (
  tensor: Float32Array, region: Exclude<RecognitionRegionKind, 'heroes'>, limit: number,
) => constrainClassProbabilitiesByRegion(await runArmyCardClassifier(tensor), await classes(), region, limit)
