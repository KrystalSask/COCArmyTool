import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArmyLink } from '../domain/armyLink'
import { ArmyDatabase, deleteArmyRecord, listArmyRecords, saveArmyRecord } from './armyDatabase'

let database: ArmyDatabase

beforeEach(() => {
  database = new ArmyDatabase(`test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await database.delete()
})

describe('本地方案库', () => {
  it('新增、读取、更新并删除方案', async () => {
    const composition = parseArmyLink('u1x0s1x0')
    const created = await saveArmyRecord({
      name: ' 测试方案 ', tags: ['空军', '空军', '  '], scenario: '练习', notes: '备注',
      originalLink: 'u1x0s1x0', composition,
    }, database)
    expect(created.name).toBe('测试方案')
    expect(created.tags).toEqual(['空军'])
    expect(await listArmyRecords(database)).toHaveLength(1)

    const updated = await saveArmyRecord({ ...created, name: '修改后' }, database)
    expect(updated.createdAt).toBe(created.createdAt)
    expect((await listArmyRecords(database))[0].name).toBe('修改后')

    await deleteArmyRecord(created.id, database)
    expect(await listArmyRecords(database)).toEqual([])
  })
})
