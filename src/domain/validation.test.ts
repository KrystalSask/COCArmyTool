import { describe, expect, it } from 'vitest'
import { parseArmyLink } from './armyLink'
import { validateComposition } from './validation'

const link = 'h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'

describe('配兵合法性校验', () => {
  it('完整配置通过校验', () => {
    expect(validateComposition(parseArmyLink(link))).toMatchObject({ valid: true, issues: [] })
  })

  it('容量和英雄配置不完整时返回可解释问题', () => {
    const army = parseArmyLink(link)
    army.troops = army.troops.filter((entry) => entry.id !== 1)
    army.heroes[0] = { ...army.heroes[0], petId: undefined, equipmentIds: [48] }
    const result = validateComposition(army)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'capacity.army', 'hero.1.pet', 'hero.1.equipmentCount',
    ]))
  })
})
