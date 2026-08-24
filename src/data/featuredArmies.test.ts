import { describe, expect, it } from 'vitest'
import { createArmyLink, normalizeComposition, parseArmyLink } from '../domain/armyLink'
import { validateComposition } from '../domain/validation'
import { featuredArmies, isFeaturedArmyFresh } from './featuredArmies'

describe('18 本热门方案快照', () => {
  it('每条方案容量完整且能生成国服链接并回环', () => {
    expect(featuredArmies).toHaveLength(5)
    featuredArmies.forEach((army) => {
      expect(validateComposition(army.composition).issues, army.name).toEqual([])
      expect(normalizeComposition(parseArmyLink(createArmyLink(army.composition)))).toEqual(normalizeComposition(army.composition))
    })
  })

  it('按来源有效期判断是否仍在近一个月窗口内', () => {
    expect(featuredArmies.every((army) => isFeaturedArmyFresh(army, new Date('2026-08-11T00:00:00Z')))).toBe(true)
    expect(featuredArmies.every((army) => !isFeaturedArmyFresh(army, new Date('2026-08-21T00:00:00Z')))).toBe(true)
  })
})
