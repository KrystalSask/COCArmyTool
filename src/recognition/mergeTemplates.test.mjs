import { describe, expect, it } from 'vitest'
import { mergeRecognitionTemplates } from '../../scripts/merge-recognition-templates.mjs'

const payload = (sourceBatch, id) => ({
  schemaVersion: 1,
  sourceBatch,
  normalization: { size: [64, 64] },
  observations: [{ sampleId: '001', kind: 'spell', id, dhash: '0', hsvHistogram: [] }],
  digitObservations: [],
  equipmentObservations: [],
  petObservations: [],
  modeObservations: [],
  digitFailures: [],
  heroSubcardFailures: [],
  mismatches: [],
  evaluation: { top1Rate: 1 },
  componentEvaluation: {},
})

describe('mergeRecognitionTemplates', () => {
  it('合并图鉴、累计覆盖并隔离重复样本编号', () => {
    const merged = mergeRecognitionTemplates([payload('first', 2), payload('second', 2), payload('second-extra', 3)])
    expect(merged.sourceBatches).toEqual(['first', 'second', 'second-extra'])
    expect(merged.observations.map((item) => item.sampleId)).toEqual(['first/001', 'second/001', 'second-extra/001'])
    expect(merged.coverage).toEqual({ 'spell:2': 2, 'spell:3': 1 })
  })
})
