import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allItems, gameData } from './gameData'
import { zhCNNames } from './localization.zh-CN'

describe('18本中文数据与图片资源审计', () => {
  it('每个协议条目都有明确的简体中文名称且不回退英文', () => {
    expect(allItems).toHaveLength(136)
    for (const item of allItems) {
      expect(zhCNNames[item.name], `${item.kind}:${item.id}:${item.name}`).toBeTruthy()
      expect(item.displayName).not.toBe(item.name)
    }
  })

  it('每个协议条目都有本地 PNG 图标', () => {
    for (const item of allItems) {
      const assetPath = join(process.cwd(), 'public', item.imagePath.replace(/^\//, ''))
      expect(existsSync(assetPath), assetPath).toBe(true)
    }
  })

  it('协议类别与图片路径类别保持一致', () => {
    for (const item of allItems) {
      expect(item.imagePath).toBe(`/game-icons/${item.kind}/${item.id}.png`)
    }
  })

  it('保留永久陨石戈仑并排除临时活动编码', () => {
    expect(gameData.troopById.has(167)).toBe(false)
    expect(gameData.troopById.get(177)).toMatchObject({
      name: 'Meteor Golem',
      housingSpace: 40,
      townHall: 17,
    })
  })
})
