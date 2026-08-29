import { describe, expect, it } from 'vitest'
import { constrainEquipmentProbabilities } from './equipmentModel'
import type { EquipmentModelManifest } from './modelManifest'

const manifest = (classes: EquipmentModelManifest['classes']): EquipmentModelManifest => ({
  schemaVersion: 1,
  modelId: 'equipment-classifier-v1',
  modelVersion: 'test',
  modelFile: 'test.onnx',
  classesFile: 'test.json',
  classCount: classes.length,
  input: { name: 'images', width: 96, height: 96, layout: 'NCHW', color: 'RGB', normalization: 'divide-255', resize: 'letterbox-edge-color' },
  output: { name: 'output0', kind: 'probabilities', shape: [1, classes.length] },
  preprocessingVersion: 'test',
  classes,
})

describe('装备模型输出适配', () => {
  it('按 manifest 的模型索引映射装备 ID，而不是按数值 ID 猜索引', () => {
    const result = constrainEquipmentProbabilities([
      .05, .8, .15,
    ], manifest([
      { modelIndex: 0, className: 'equipment_10', equipmentId: 10, ownerHeroId: 0 },
      { modelIndex: 1, className: 'equipment_52', equipmentId: 52, ownerHeroId: 7 },
      { modelIndex: 2, className: 'equipment_3', equipmentId: 3, ownerHeroId: 1 },
    ]), 3)
    expect(result.map((candidate) => candidate.id)).toEqual([52, 3, 10])
    expect(result.every((candidate) => candidate.source === 'onnx')).toBe(true)
  })

  it('拒绝形状错误或全零的模型输出', () => {
    const smallManifest = manifest([
      { modelIndex: 0, className: 'equipment_0', equipmentId: 0, ownerHeroId: 0 },
      { modelIndex: 1, className: 'equipment_1', equipmentId: 1, ownerHeroId: 0 },
    ])
    expect(() => constrainEquipmentProbabilities([1], smallManifest)).toThrow()
    expect(() => constrainEquipmentProbabilities([0, 0], smallManifest)).toThrow()
  })
})
