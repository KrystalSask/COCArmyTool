import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_COMPOSITION } from '../domain/types'
import { ArmyDatabase } from './armyDatabase'
import { BACKUP_FORMAT, BACKUP_VERSION, createArmyBackup, importArmyBackup, parseArmyBackup } from './armyBackup'

let database: ArmyDatabase
const record = (id: string, updatedAt: string, name = '测试') => ({ id, name, tags: [], scenario: '练习' as const, notes: '', originalLink: '', composition: structuredClone(EMPTY_COMPOSITION), createdAt: '2026-08-01T00:00:00.000Z', updatedAt })

beforeEach(() => { database = new ArmyDatabase(`backup-${crypto.randomUUID()}`) })
afterEach(async () => database.delete())

describe('方案 JSON 备份', () => {
  it('导出带格式标识的完整备份并严格解析', async () => {
    await database.armies.add(record('one', '2026-08-12T00:00:00.000Z'))
    const backup = await createArmyBackup(database)
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION })
    expect(parseArmyBackup(JSON.stringify(backup)).records).toHaveLength(1)
    expect(() => parseArmyBackup('{"format":"wrong"}')).toThrow(/不是 COC/)
  })

  it('同 ID 保留较新记录并以单个事务导入', async () => {
    await database.armies.add(record('same', '2026-08-10T00:00:00.000Z', '本机旧版'))
    const report = await importArmyBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), records: [record('same', '2026-08-12T00:00:00.000Z', '导入新版'), record('new', '2026-08-11T00:00:00.000Z')] }, database)
    expect(report).toEqual({ inserted: 1, updated: 1, copied: 0, skipped: 0 })
    expect((await database.armies.get('same'))?.name).toBe('导入新版')
  })
})
