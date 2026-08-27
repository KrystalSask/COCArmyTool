import { describe, expect, it } from 'vitest'
import { recognizedPetId, resolveEquipmentPairCandidates } from './heroSubcardAnalysis'
import { officialEquipmentObservations } from './officialEquipmentTemplates'

describe('resolveEquipmentPairCandidates', () => {
  it('rejects duplicate equipment and chooses the strongest legal same-hero pair', () => {
    const resolved = resolveEquipmentPairCandidates([
      [{ id: 52, score: .841 }, { id: 57, score: .835 }],
      [{ id: 52, score: .855 }, { id: 57, score: .718 }],
    ])

    expect(resolved.map((slot) => slot[0].id)).toEqual([57, 52])
  })

  it('uses the independent revenge-deck reference ahead of the weaker rocket-backpack match', () => {
    expect(officialEquipmentObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 60, dhash: '102c58bab0e0d020' }),
    ]))
    expect(officialEquipmentObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 60, sampleId: 'equipment-regression/revenge-deck-panel' }),
      expect.objectContaining({ id: 53, sampleId: 'equipment-regression/rocket-backpack-panel' }),
    ]))
    expect(officialEquipmentObservations.every((observation) => observation.hsvHistogram.length === 128)).toBe(true)
    const resolved = resolveEquipmentPairCandidates([
      [{ id: 52, score: .708 }],
      [{ id: 39, score: .628 }, { id: 60, score: .602 }, { id: 53, score: .586 }],
    ])
    expect(resolved.map((slot) => slot[0].id)).toEqual([52, 60])
  })
})

describe('recognizedPetId', () => {
  it('accepts a compressed but clearly leading pet candidate', () => {
    expect(recognizedPetId([{ id: 16, score: .604 }, { id: 9, score: .533 }, { id: 0, score: .520 }])).toBe(16)
  })

  it('rejects an ambiguous empty-slot match', () => {
    expect(recognizedPetId([{ id: 9, score: .580 }, { id: 17, score: .578 }, { id: 16, score: .574 }])).toBeUndefined()
  })
})
