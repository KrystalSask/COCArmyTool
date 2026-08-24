import { describe, expect, it } from 'vitest'
import { resolveEquipmentPairCandidates } from './heroSubcardAnalysis'

describe('resolveEquipmentPairCandidates', () => {
  it('rejects duplicate equipment and chooses the strongest legal same-hero pair', () => {
    const resolved = resolveEquipmentPairCandidates([
      [{ id: 52, score: .841 }, { id: 57, score: .835 }],
      [{ id: 52, score: .855 }, { id: 57, score: .718 }],
    ])

    expect(resolved.map((slot) => slot[0].id)).toEqual([57, 52])
  })
})
