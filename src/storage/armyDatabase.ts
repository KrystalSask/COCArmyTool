import Dexie, { type EntityTable } from 'dexie'
import type { ArmyRecord } from '../domain/types'

export class ArmyDatabase extends Dexie {
  armies!: EntityTable<ArmyRecord, 'id'>

  constructor(name = 'coc-army-assistant') {
    super(name)
    this.version(1).stores({
      armies: 'id, name, scenario, createdAt, updatedAt, *tags',
    })
  }
}

export const db = new ArmyDatabase()

export interface ArmyRecordInput {
  id?: string
  name: string
  tags: string[]
  scenario: ArmyRecord['scenario']
  notes: string
  originalLink: string
  composition: ArmyRecord['composition']
}

export const saveArmyRecord = async (input: ArmyRecordInput, database = db): Promise<ArmyRecord> => {
  const existing = input.id ? await database.armies.get(input.id) : undefined
  const now = new Date().toISOString()
  const record: ArmyRecord = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim() || '未命名配兵',
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await database.armies.put(record)
  return record
}

export const listArmyRecords = async (database = db): Promise<ArmyRecord[]> =>
  database.armies.orderBy('updatedAt').reverse().toArray()

export const deleteArmyRecord = async (id: string, database = db): Promise<void> => {
  await database.armies.delete(id)
}
