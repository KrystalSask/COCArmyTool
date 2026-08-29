import { describe, expect, it } from 'vitest'
import { parseArmyLink } from './armyLink'
import { checkContainerConditions, validateComposition } from './validation'

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

describe('容器条件（识别页回传闸门）', () => {
  it('援军无攻城机器但容量容器全部填满时通过', () => {
    // 真实军队允许城堡不带攻城机器（样本 007）；容器条件只看四个容量容器。
    const army = parseArmyLink(link)
    const castleSieges = army.clanCastleTroops.filter((entry) => [188].includes(entry.id))
    army.clanCastleTroops = army.clanCastleTroops.filter((entry) => !castleSieges.includes(entry))
    expect(checkContainerConditions(army).valid).toBe(true)
    expect(validateComposition(army).issues.map((issue) => issue.code)).toContain('capacity.clanCastleSiegeMachines')
  })

  it('主军队容量不满时不通过', () => {
    const army = parseArmyLink(link)
    army.troops = army.troops.filter((entry) => entry.id !== 1)
    expect(checkContainerConditions(army).valid).toBe(false)
  })
})
