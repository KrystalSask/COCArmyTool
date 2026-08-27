import { describe, expect, it } from 'vitest'
import { greedyCtcDecode, parseArmyCountText } from './armyCountOcr'

describe('army count OCR postprocessing', () => {
  it.each([['x1', 1], ['X10', 10], ['×17', 17], ['9', 9]])('parses %s', (text, expected) => {
    expect(parseArmyCountText(text)).toBe(expected)
  })

  it.each(['', 'x0', 'x100', 'none'])('rejects %s', (text) => {
    expect(parseArmyCountText(text)).toBeUndefined()
  })

  it('removes blank and collapses consecutive CTC duplicates', () => {
    const charset = ['blank', 'x', '1', '0']
    const indexes = [1, 1, 0, 2, 2, 0, 3]
    const values = indexes.flatMap((selected) => charset.map((_value, index) => index === selected ? .9 : .01))
    expect(greedyCtcDecode(values, indexes.length, charset.length, charset)).toMatchObject({ text: 'x10', confidence: .9 })
  })
})
