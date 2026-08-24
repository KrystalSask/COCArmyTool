import { parseArmyLink } from '../domain/armyLink'
import type { ArmyComposition } from '../domain/types'
import { isSiegeMachine } from './gameData'

export interface FeaturedArmy {
  id: string
  name: string
  archetype: string
  difficulty: '简单' | '中等' | '中高'
  tags: string[]
  summary: string
  sourceName: string
  sourceUrl: string
  publishedAt: string
  collectedAt: string
  expiresAt: string
  metaEvidence?: string
  sourceArmyLink: string
  composition: ArmyComposition
}

const SOURCE_URL = 'https://blueprintcoc.com/blogs/town-hall-18/top-5-th18-army-links'

const fillCnSiegeReserveSlots = (source: ArmyComposition): ArmyComposition => {
  const composition = structuredClone(source)
  const mainSiege = composition.troops.filter((entry) => isSiegeMachine(entry.id))
  const castleSiege = composition.clanCastleTroops.filter((entry) => isSiegeMachine(entry.id))
  const selectedSiegeId = castleSiege[0]?.id ?? mainSiege[0]?.id
  if (selectedSiegeId === undefined) return composition

  const fill = (entries: typeof composition.troops, current: number, target: number) => {
    if (current >= target) return
    const existing = entries.find((entry) => entry.id === selectedSiegeId)
    if (existing) existing.count += target - current
    else entries.push({ id: selectedSiegeId, count: target - current })
  }
  fill(composition.troops, mainSiege.reduce((sum, entry) => sum + entry.count, 0), 3)
  fill(composition.clanCastleTroops, castleSiege.reduce((sum, entry) => sum + entry.count, 0), 2)
  return composition
}

const makeFeaturedArmy = (
  army: Omit<FeaturedArmy, 'sourceName' | 'sourceUrl' | 'publishedAt' | 'collectedAt' | 'expiresAt' | 'sourceArmyLink' | 'composition'>,
  link: string,
): FeaturedArmy => ({
  ...army,
  sourceName: 'Blueprint CoC · Loki',
  sourceUrl: SOURCE_URL,
  publishedAt: '2026-07-20',
  collectedAt: '2026-08-11',
  expiresAt: '2026-08-20',
  sourceArmyLink: link,
  composition: fillCnSiegeReserveSlots(parseArmyLink(link)),
})

/**
 * 近 30 天的 18 本创作者配兵快照。
 *
 * 这里保存结构化结果和出处，而不在客户端运行爬虫。每次更新都必须核对原文发布日期、
 * CopyArmy 链接回环及 18 本容量；过期条目仍可查看，但界面会明确提示需要复核。
 */
export const featuredArmies: FeaturedArmy[] = [
  makeFeaturedArmy({
    id: '2026-07-blueprint-hydra',
    name: '冰狗龙骑混合',
    archetype: 'Hydra',
    difficulty: '简单',
    tags: ['空军', '传奇杯', '部落战', '稳健'],
    summary: '冰狗承伤，龙与龙骑推进，咏王和飞龙公爵分别负责保队与断边。适合多数阵型。',
    metaEvidence: '官方 7 月环境数据：飞龙公爵带领的龙系是 18 本对 18 本最常见战争流派，约占 20%。',
  }, 'https://link.clashofclans.com/en/?action=CopyArmy&army=h6p17e43_49-2m1p16e4_24-1p9e17_48-7p4e52_59i2x65-1x5-1x188d2x98u8x8-6x65-1x76-1x10s4x120-2x5-2x70-1x9'),
  makeFeaturedArmy({
    id: '2026-07-blueprint-qc-super-bowlers',
    name: '天女超级蓝胖',
    archetype: 'Queen Charge Super Bowlers',
    difficulty: '中等',
    tags: ['地面', '天女', '部落战', '传奇杯'],
    summary: '女王和天使先处理核心威胁，再召回并与超级蓝胖主力会合，适合紧凑型阵地。',
  }, 'https://link.clashofclans.com/en/?action=CopyArmy&army=h1p17e16_48-0p9e14_32-2p7e4_19-7p10e52_59i1x147-1x64-1x188d1x9-1x17-1x53u1x1-3x28-3x5-2x6-5x7-1x23-2x58-1x82-1x97-5x80-1x123-1x10-1x62-1x52-1x75s3x35-2x120-3x2'),
  makeFeaturedArmy({
    id: '2026-07-blueprint-edrag-spam',
    name: '雷龙推进',
    archetype: 'Electro Dragon Spam',
    difficulty: '简单',
    tags: ['空军', '雷龙', '紧凑阵', '易上手'],
    summary: '双侧英雄完成漏斗后，雷龙、气球和空中咏王集中穿过核心，适合建筑密集阵型。',
  }, 'https://link.clashofclans.com/en/?action=CopyArmy&army=h1p9e17_48-6p17e43_49-2m1p16e4_24-7p4e53_52i1x59-1x65-1x188d2x98u10x59-8x5-1x23-1x10-1x62-1x52-1x75s1x2-1x70-6x120-1x5'),
  makeFeaturedArmy({
    id: '2026-07-blueprint-zap-throwers',
    name: '闪震投矛手',
    archetype: 'Zap Throwers',
    difficulty: '中等',
    tags: ['地面', '投矛手', '闪震', '部落战'],
    summary: '先用闪震与火箭背包拆除高价值防御，再由投矛手、天使和滚木车沿规划路线推进。',
    metaEvidence: '官方 7 月环境数据：天使支援的投矛手是 18 本第二热门战争流派；与龙系合计约占 40%。',
  }, 'https://link.clashofclans.com/en/?action=CopyArmy&army=h0p9e14_32-1p3e48_39-2p16e5_24-7p4e53_52i1x147-1x64-1x188-1x87d3x0-1x10u2x5-2x1-5x7-2x28-2x58-2x82-11x132-4x26-1x123-1x91-1x135-1x188s4x120-1x9-1x35-1x5-1x70-1x98'),
  makeFeaturedArmy({
    id: '2026-07-blueprint-rc-meteor-golems',
    name: '冠军天降石人',
    archetype: 'RC Walk Meteor Golem',
    difficulty: '中高',
    tags: ['地面', '冠军漫步', '天降石人', '多线操作'],
    summary: '飞盾战神先做一侧漏斗，召回后与天降石人、天使和运兵发射器合流推进。',
  }, 'https://link.clashofclans.com/en/?action=CopyArmy&army=h1p9e39_48-4p10e40_13-2p16e4_24-0p4e14_32i1x177-1x58-1x135d1x70-1x2u5x7-5x177-2x82-2x5-1x58-1x97-1x28-1x23-1x6-1x1-1x10s1x5-5x35-2x120-1x9-1x53'),
]

export const isFeaturedArmyFresh = (army: FeaturedArmy, now = new Date()): boolean =>
  now.getTime() <= new Date(`${army.expiresAt}T23:59:59Z`).getTime()
