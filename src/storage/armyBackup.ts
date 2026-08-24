import type { ArmyComposition, ArmyRecord, ArmyScenario, CountEntry, HeroLoadout } from '../domain/types'
import { ArmyDatabase, db, listArmyRecords } from './armyDatabase'

export const BACKUP_FORMAT = 'coc-army-assistant-backup'
export const BACKUP_VERSION = 1

export interface ArmyBackup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  records: ArmyRecord[]
}

export interface ImportReport { inserted: number; updated: number; copied: number; skipped: number }

const scenarios = new Set<ArmyScenario>(['部落战', '联赛', '打鱼', '冲杯', '练习', '其他'])
const isCountEntry = (value: unknown): value is CountEntry => Boolean(value && typeof value === 'object' && Number.isInteger((value as CountEntry).id) && Number.isInteger((value as CountEntry).count) && (value as CountEntry).count >= 0)
const isHero = (value: unknown): value is HeroLoadout => Boolean(value && typeof value === 'object' && Number.isInteger((value as HeroLoadout).heroId) && Array.isArray((value as HeroLoadout).equipmentIds) && (value as HeroLoadout).equipmentIds.every(Number.isInteger))
const isComposition = (value: unknown): value is ArmyComposition => {
  if (!value || typeof value !== 'object') return false
  const item = value as ArmyComposition
  return Array.isArray(item.heroes) && item.heroes.every(isHero)
    && Array.isArray(item.troops) && item.troops.every(isCountEntry)
    && Array.isArray(item.spells) && item.spells.every(isCountEntry)
    && Array.isArray(item.clanCastleTroops) && item.clanCastleTroops.every(isCountEntry)
    && Array.isArray(item.clanCastleSpells) && item.clanCastleSpells.every(isCountEntry)
}
const isIsoDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isRecord = (value: unknown): value is ArmyRecord => {
  if (!value || typeof value !== 'object') return false
  const item = value as ArmyRecord
  return typeof item.id === 'string' && Boolean(item.id)
    && typeof item.name === 'string' && Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === 'string')
    && scenarios.has(item.scenario) && typeof item.notes === 'string' && typeof item.originalLink === 'string'
    && isIsoDate(item.createdAt) && isIsoDate(item.updatedAt) && isComposition(item.composition)
}

export const createArmyBackup = async (database = db): Promise<ArmyBackup> => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: new Date().toISOString(),
  records: await listArmyRecords(database),
})

export const parseArmyBackup = (text: string): ArmyBackup => {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('备份文件不是有效的 JSON。') }
  if (!value || typeof value !== 'object') throw new Error('备份文件结构无效。')
  const backup = value as ArmyBackup
  if (backup.format !== BACKUP_FORMAT) throw new Error('这不是 COCArmyTool 兼容的备份文件。')
  if (backup.version !== BACKUP_VERSION) throw new Error(`不支持的备份版本：${String(backup.version)}。`)
  if (!isIsoDate(backup.exportedAt) || !Array.isArray(backup.records) || !backup.records.every(isRecord)) throw new Error('备份中的方案字段或配兵结构无效。')
  return backup
}

export const importArmyBackup = async (backup: ArmyBackup, database: ArmyDatabase = db): Promise<ImportReport> => {
  const report: ImportReport = { inserted: 0, updated: 0, copied: 0, skipped: 0 }
  await database.transaction('rw', database.armies, async () => {
    for (const incoming of backup.records) {
      const existing = await database.armies.get(incoming.id)
      if (!existing) { await database.armies.add(structuredClone(incoming)); report.inserted += 1; continue }
      const incomingTime = Date.parse(incoming.updatedAt)
      const existingTime = Date.parse(existing.updatedAt)
      if (Number.isFinite(incomingTime) && Number.isFinite(existingTime)) {
        if (incomingTime > existingTime) { await database.armies.put(structuredClone(incoming)); report.updated += 1 } else report.skipped += 1
        continue
      }
      await database.armies.add({ ...structuredClone(incoming), id: crypto.randomUUID(), name: `${incoming.name}（导入副本）` })
      report.copied += 1
    }
  })
  return report
}
