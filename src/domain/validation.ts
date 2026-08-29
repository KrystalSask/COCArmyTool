import { gameData, isSiegeMachine } from '../data/gameData'
import type { ArmyComposition, CapacitySummary, CountEntry, ValidationIssue, ValidationResult } from './types'

export const LIMITS: CapacitySummary = {
  army: 352,
  spells: 11,
  siegeMachines: 3,
  clanCastleTroops: 55,
  clanCastleSiegeMachines: 2,
  clanCastleSpells: 4,
}

export const ACTIVE_HERO_SLOTS = 4
export const WARDEN_ID = 2

const sumHousing = (entries: CountEntry[], lookup: Map<number, { housingSpace: number }>, excludeSiege = false) =>
  entries.reduce((total, entry) => {
    if (excludeSiege && isSiegeMachine(entry.id)) return total
    return total + entry.count * (lookup.get(entry.id)?.housingSpace ?? 0)
  }, 0)

export const calculateCapacities = (composition: ArmyComposition): CapacitySummary => ({
  army: sumHousing(composition.troops, gameData.troopById, true),
  spells: sumHousing(composition.spells, gameData.spellById),
  siegeMachines: composition.troops.filter((entry) => isSiegeMachine(entry.id)).reduce((sum, entry) => sum + entry.count, 0),
  clanCastleTroops: sumHousing(composition.clanCastleTroops, gameData.troopById, true),
  clanCastleSiegeMachines: composition.clanCastleTroops.filter((entry) => isSiegeMachine(entry.id)).reduce((sum, entry) => sum + entry.count, 0),
  clanCastleSpells: sumHousing(composition.clanCastleSpells, gameData.spellById),
})

const addCapacityIssue = (issues: ValidationIssue[], key: keyof CapacitySummary, actual: number, expected: number, label: string) => {
  if (actual !== expected) issues.push({ code: `capacity.${key}`, message: `${label}需要达到 ${expected}，当前为 ${actual}` })
}

// 容器条件：截图识别页回传样本前的容量闸门。只要求四个容量容器
// （主军队、主法术、援军兵种、援军法术）恰好填满；攻城机器在游戏里
// 允许不满编（如城堡 0~2 台），因此只做上限检查，不要求精确等于上限。
// 编辑器导出链接仍走完整 validateComposition。
export const checkContainerConditions = (composition: ArmyComposition): ValidationResult => {
  const capacities = calculateCapacities(composition)
  const issues: ValidationIssue[] = []
  addCapacityIssue(issues, 'army', capacities.army, LIMITS.army, '主军队容量')
  addCapacityIssue(issues, 'spells', capacities.spells, LIMITS.spells, '主法术容量')
  addCapacityIssue(issues, 'clanCastleTroops', capacities.clanCastleTroops, LIMITS.clanCastleTroops, '援军兵种容量')
  addCapacityIssue(issues, 'clanCastleSpells', capacities.clanCastleSpells, LIMITS.clanCastleSpells, '援军法术容量')
  if (capacities.siegeMachines > LIMITS.siegeMachines) {
    issues.push({ code: 'capacity.siegeMachines', message: `自带攻城机器不能超过 ${LIMITS.siegeMachines}，当前为 ${capacities.siegeMachines}` })
  }
  if (capacities.clanCastleSiegeMachines > LIMITS.clanCastleSiegeMachines) {
    issues.push({ code: 'capacity.clanCastleSiegeMachines', message: `援军攻城机器不能超过 ${LIMITS.clanCastleSiegeMachines}，当前为 ${capacities.clanCastleSiegeMachines}` })
  }
  return { valid: issues.length === 0, capacities, issues }
}

export const validateComposition = (composition: ArmyComposition): ValidationResult => {
  const capacities = calculateCapacities(composition)
  const issues: ValidationIssue[] = []
  addCapacityIssue(issues, 'army', capacities.army, LIMITS.army, '主军队容量')
  addCapacityIssue(issues, 'spells', capacities.spells, LIMITS.spells, '主法术容量')
  addCapacityIssue(issues, 'siegeMachines', capacities.siegeMachines, LIMITS.siegeMachines, '自带攻城机器')
  addCapacityIssue(issues, 'clanCastleTroops', capacities.clanCastleTroops, LIMITS.clanCastleTroops, '援军兵种容量')
  addCapacityIssue(issues, 'clanCastleSiegeMachines', capacities.clanCastleSiegeMachines, LIMITS.clanCastleSiegeMachines, '援军攻城机器')
  addCapacityIssue(issues, 'clanCastleSpells', capacities.clanCastleSpells, LIMITS.clanCastleSpells, '援军法术容量')

  const checkKnownEntries = (entries: CountEntry[], label: string, spell = false) => {
    const seen = new Set<number>()
    entries.forEach((entry) => {
      const known = spell ? gameData.spellById.has(entry.id) : gameData.troopById.has(entry.id) || gameData.siegeById.has(entry.id)
      if (!known) issues.push({ code: `unknown.${label}.${entry.id}`, message: `${label}包含当前版本无法识别的 ID ${entry.id}` })
      if (seen.has(entry.id)) issues.push({ code: `duplicate.${label}.${entry.id}`, message: `${label}中 ID ${entry.id} 重复出现` })
      seen.add(entry.id)
      if (!Number.isInteger(entry.count) || entry.count <= 0) issues.push({ code: `count.${label}.${entry.id}`, message: `${label}包含无效数量` })
    })
  }
  checkKnownEntries(composition.troops, '主军队')
  checkKnownEntries(composition.spells, '主法术', true)
  checkKnownEntries(composition.clanCastleTroops, '援军')
  checkKnownEntries(composition.clanCastleSpells, '援军法术', true)

  if (composition.heroes.length !== ACTIVE_HERO_SLOTS) {
    issues.push({ code: 'heroes.count', message: `需要配置 ${ACTIVE_HERO_SLOTS} 位出战英雄` })
  }
  if (new Set(composition.heroes.map((hero) => hero.heroId)).size !== composition.heroes.length) {
    issues.push({ code: 'heroes.unique', message: '出战英雄不能重复' })
  }
  const petIds = composition.heroes.flatMap((hero) => hero.petId === undefined ? [] : [hero.petId])
  if (new Set(petIds).size !== petIds.length) issues.push({ code: 'pets.unique', message: '同一宠物不能分配给多位英雄' })

  composition.heroes.forEach((hero) => {
    const heroItem = gameData.heroById.get(hero.heroId)
    const heroName = heroItem?.displayName ?? `英雄 ${hero.heroId}`
    if (!heroItem) issues.push({ code: `hero.${hero.heroId}.unknown`, message: `${heroName}不在当前18本数据中` })
    if (hero.petId === undefined || !gameData.petById.has(hero.petId)) {
      issues.push({ code: `hero.${hero.heroId}.pet`, message: `${heroName}需要配置有效宠物` })
    }
    if (hero.equipmentIds.length !== 2 || new Set(hero.equipmentIds).size !== 2) {
      issues.push({ code: `hero.${hero.heroId}.equipmentCount`, message: `${heroName}需要配置两件不同装备` })
    }
    hero.equipmentIds.forEach((equipmentId) => {
      const equipment = gameData.equipmentById.get(equipmentId)
      if (!equipment || equipment.hero !== heroItem?.name) {
        issues.push({ code: `hero.${hero.heroId}.equipment.${equipmentId}`, message: `${heroName}包含不适用的装备` })
      }
    })
    if (hero.heroId === WARDEN_ID && hero.mode === undefined) {
      issues.push({ code: 'hero.warden.mode', message: '大守护者需要选择地面或空中模式' })
    }
  })

  return { valid: issues.length === 0, capacities, issues }
}
