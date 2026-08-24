import { describe, expect, it } from 'vitest'
import { createArmyLink, normalizeComposition, parseArmyLink } from './armyLink'
import { calculateCapacities, validateComposition } from './validation'

const REGRESSION_LINK = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'

describe('国服 CopyArmy 编解码', () => {
  it('解析核心回归链接并还原全部容量', () => {
    const army = parseArmyLink(REGRESSION_LINK)
    expect(calculateCapacities(army)).toEqual({
      army: 352,
      spells: 11,
      siegeMachines: 3,
      clanCastleTroops: 55,
      clanCastleSiegeMachines: 2,
      clanCastleSpells: 4,
    })
    expect(army.heroes).toEqual([
      { heroId: 1, petId: 9, equipmentIds: [48, 17] },
      { heroId: 2, mode: 1, petId: 16, equipmentIds: [4, 5] },
      { heroId: 6, petId: 17, equipmentIds: [49, 43] },
      { heroId: 7, petId: 4, equipmentIds: [52, 53] },
    ])
    expect(validateComposition(army).valid).toBe(true)
  })

  it('解析、生成、再解析后保持标准化配置一致', () => {
    const first = parseArmyLink(REGRESSION_LINK)
    const generated = createArmyLink(first)
    expect(normalizeComposition(parseArmyLink(generated))).toEqual(normalizeComposition(first))
  })

  it('真实视觉结果即使英雄字段插入顺序不同也能通过字符串回环比较', () => {
    const composition = {
      heroes: [
        { heroId: 2, petId: 16, equipmentIds: [4, 34], mode: 0 },
        { heroId: 1, petId: 9, equipmentIds: [48, 17] },
        { heroId: 7, petId: 4, equipmentIds: [57, 53] },
        { heroId: 0, petId: 8, equipmentIds: [8, 14] },
      ],
      troops: [{ id: 8, count: 5 }, { id: 188, count: 1 }],
      spells: [{ id: 120, count: 1 }],
      clanCastleTroops: [{ id: 188, count: 2 }],
      clanCastleSpells: [{ id: 70, count: 1 }],
    }
    const roundTrip = normalizeComposition(parseArmyLink(createArmyLink(composition)))
    expect(JSON.stringify(roundTrip)).toBe(JSON.stringify(normalizeComposition(composition)))
  })

  it('接受 HTML 转义后的链接', () => {
    expect(parseArmyLink(REGRESSION_LINK.replace('&army=', '&amp;army='))).toEqual(parseArmyLink(REGRESSION_LINK))
  })

  it('将省略的守护者模式解析为地面模式并按国服格式省略 m0', () => {
    const link = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h2p16e4_34'
    const composition = parseArmyLink(link)
    expect(composition.heroes[0]).toEqual({ heroId: 2, mode: 0, petId: 16, equipmentIds: [4, 34] })
    expect(createArmyLink(composition)).toContain('army=h2p16e4_34')
    expect(createArmyLink(composition)).not.toContain('m0')
  })

  it('拒绝缺少 army 参数和格式损坏的条目', () => {
    expect(() => parseArmyLink('https://example.com/?action=CopyArmy')).toThrow('缺少 army 参数')
    expect(() => parseArmyLink('u2x1-bad')).toThrow()
  })
})
