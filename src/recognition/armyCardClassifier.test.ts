import { describe, expect, it } from 'vitest'
import { allowedKindsForRegion, constrainClassProbabilitiesByRegion } from './armyCardClassifier'
import { rgbImageToChw } from './armyCardCrop'
import type { ArmyCardClassDefinition } from './modelManifest'

const definitions = Array.from({ length: 76 }, (_, index): ArmyCardClassDefinition => ({
  index, className: `${index < 9 ? 'siege' : index < 27 ? 'spell' : 'troop'}_${String(index).padStart(3, '0')}_test`,
  kind: index < 9 ? 'siege' : index < 27 ? 'spell' : 'troop', id: index,
}))

describe('army card classifier preprocessing and constraints', () => {
  it('converts RGBA RGB planes to normalized CHW order', () => {
    const result = [...rgbImageToChw(new Uint8ClampedArray([255, 128, 0, 255, 0, 64, 255, 255]), 2, 1)]
    expect(result[0]).toBe(1); expect(result[1]).toBe(0)
    expect(result[2]).toBeCloseTo(128 / 255); expect(result[3]).toBeCloseTo(64 / 255)
    expect(result.slice(4)).toEqual([0, 1])
  })

  it('allows only the region categories and renormalizes existing probabilities without softmax', () => {
    const probabilities = Array(76).fill(0)
    probabilities[0] = .1; probabilities[9] = .2; probabilities[27] = .3; probabilities[28] = .4
    expect(allowedKindsForRegion('mainTroops')).toEqual(['troop'])
    expect(allowedKindsForRegion('mainSpells')).toEqual(['spell'])
    expect(allowedKindsForRegion('mainSiege')).toEqual(['siege'])
    expect(allowedKindsForRegion('castleArmy')).toEqual(['troop', 'spell', 'siege'])
    const result = constrainClassProbabilitiesByRegion(probabilities, definitions, 'mainTroops', 3)
    expect(result.map((item) => item.kind)).toEqual(['troop', 'troop', 'troop'])
    expect(result[0]).toMatchObject({ id: 28, rawScore: .4, score: .4 / .7 })
  })
})
