import { describe, expect, it } from 'vitest'
import { createLoadoutFromEvidence, inferHeroFromEquipment } from './heroInference'

describe('装备归属优先的英雄推理', () => {
  it('两件同英雄装备可以确定英雄且不依赖立绘', () => {
    expect(inferHeroFromEquipment([2, 3])).toMatchObject({ status: 'confirmed', heroId: 1 })
  })

  it('不同英雄装备会报告冲突', () => {
    expect(inferHeroFromEquipment([0, 2])).toMatchObject({ status: 'conflict', ownerIds: [0, 1] })
  })

  it('重复装备不会被误认为是合法英雄配置', () => {
    expect(inferHeroFromEquipment([52, 52])).toMatchObject({ status: 'incomplete' })
  })

  it('大守护者模式证据会写入配置', () => {
    expect(createLoadoutFromEvidence([4, 5], 3, { value: 1, score: .92, confirmed: true })).toEqual({
      heroId: 2, equipmentIds: [4, 5], petId: 3, mode: 1,
    })
  })
})
