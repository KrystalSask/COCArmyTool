import { describe, expect, it } from 'vitest'
import { applyLegacyRuleCorrections, constrainCountsToCapacity, resolveDuplicateItemCandidates, validateCardRules } from './countConstraints'
import type { DetectedCardSlot } from './cardDetector'

const slot = (id: number, values: number[], selected = values[0]): DetectedCardSlot => ({
  rect: { x: 0, y: 0, width: .1, height: .1 },
  badgeConfidence: .9,
  candidates: [{ id, kind: 'troop', score: .9 }],
  count: {
    value: selected,
    confidence: .9,
    digits: [],
    candidates: values.map((value, index) => ({ value, score: .95 - index * .01 })),
  },
})

describe('capacity-constrained quantity decoding', () => {
  it('warn-only validation never rewrites visual category or OCR quantity', () => {
    const first = slot(57, [5], 5)
    first.candidates = [{ id: 57, kind: 'troop', score: .91 }, { id: 17, kind: 'troop', score: .66 }]
    const second = slot(57, [1, 20], 1)
    second.candidates = [{ id: 57, kind: 'troop', score: .69 }, { id: 17, kind: 'troop', score: .68 }]
    const before = structuredClone([first, second])

    const validation = validateCardRules('mainTroops', [first, second])

    expect([first, second]).toEqual(before)
    expect(validation.issues.map((issue) => issue.code)).toEqual(['duplicate-category', 'capacity-mismatch'])
    expect(validation.suggestions[0]).toMatchObject({ kind: 'category', slotIndex: 1 })
  })

  it('keeps automatic correction behind an explicit legacy rollback API', () => {
    const slots = [slot(0, [1]), slot(1, [3])]
    expect(applyLegacyRuleCorrections('mainTroops', slots).map((item) => item.count?.value)).toEqual([1, 3])
  })

  it('recovers x20 and x5 alternatives needed to reach 352 housing space', () => {
    const slots = [
      slot(0, [1]), slot(1, [3]), slot(76, [2]), slot(5, [10, 20]), slot(8, [1, 5]),
      slot(23, [2]), slot(10, [2]), slot(57, [5]), slot(6, [1]),
    ]
    const resolved = constrainCountsToCapacity('mainTroops', slots)
    expect(resolved.map((item) => item.count?.value)).toEqual([1, 3, 2, 20, 5, 2, 2, 5, 1])
    expect(resolved[3].count?.constrained).toBe(true)
    expect(resolved[4].count?.constrained).toBe(true)
  })

  it('does not force an answer when no exact capacity solution exists', () => {
    const slots = [slot(0, [1]), slot(1, [3])]
    expect(constrainCountsToCapacity('mainTroops', slots).map((item) => item.count?.value)).toEqual([1, 3])
  })

  it('fills a completely unreadable quantity only when capacity has one exact answer', () => {
    const slots = [
      slot(0, [1]), slot(1, [3]), slot(76, [2]), slot(5, []), slot(8, [5]),
      slot(23, [2]), slot(10, [2]), slot(57, [5]), slot(6, [1]),
    ]
    const resolved = constrainCountsToCapacity('mainTroops', slots)
    expect(resolved[3].count?.value).toBe(20)
    expect(resolved[3].count?.constrained).toBe(true)
  })

  it('keeps the larger duplicate quantity and promotes the smaller card alternative', () => {
    const rocketBalloons = slot(57, [5], 5)
    rocketBalloons.candidates = [{ id: 57, kind: 'troop', score: .91 }, { id: 17, kind: 'troop', score: .66 }]
    const lavaHound = slot(57, [1], 1)
    lavaHound.candidates = [{ id: 57, kind: 'troop', score: .69 }, { id: 17, kind: 'troop', score: .68 }, { id: 6, kind: 'troop', score: .64 }]

    const resolved = resolveDuplicateItemCandidates([lavaHound, rocketBalloons])
    expect(resolved.map((item) => item.candidates?.[0].id)).toEqual([17, 57])
    expect(resolved[0].categoryConstrained).toBe(true)
    expect(resolved[1].categoryConstrained).not.toBe(true)
  })
})
