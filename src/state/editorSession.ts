import { cloneComposition } from '../domain/composition'
import type { ArmyComposition, ArmyRecord } from '../domain/types'
import { EMPTY_COMPOSITION } from '../domain/types'

export type EditorSource = 'link' | 'screenshot' | 'manual' | 'library'

export interface EditorSession {
  source: EditorSource
  recordId?: string
  composition: ArmyComposition
  originalLink?: string
  name: string
  tags: string[]
  tagsText: string
  scenario: ArmyRecord['scenario']
  notes: string
  dirty: boolean
}

export interface EditorSessionInput {
  source: EditorSource
  composition?: ArmyComposition
  record?: ArmyRecord
  originalLink?: string
  name?: string
  tags?: string[]
  tagsText?: string
  scenario?: ArmyRecord['scenario']
  notes?: string
}

export const createEditorSession = (input: EditorSessionInput): EditorSession => ({
  source: input.source,
  recordId: input.record?.id,
  composition: cloneComposition(input.record?.composition ?? input.composition ?? EMPTY_COMPOSITION),
  originalLink: input.originalLink ?? input.record?.originalLink,
  name: input.name ?? input.record?.name ?? '',
  tags: [...(input.tags ?? input.record?.tags ?? [])],
  tagsText: input.tagsText ?? (input.tags ?? input.record?.tags ?? []).join('、'),
  scenario: input.scenario ?? input.record?.scenario ?? '部落战',
  notes: input.notes ?? input.record?.notes ?? '',
  dirty: false,
})

export const markEditorSessionDirty = (session: EditorSession, patch: Partial<Omit<EditorSession, 'source' | 'dirty'>>): EditorSession => ({
  ...session,
  ...patch,
  dirty: true,
})

export const markEditorSessionSaved = (session: EditorSession, record: ArmyRecord): EditorSession => ({
  ...session,
  recordId: record.id,
  originalLink: record.originalLink,
  name: record.name,
  tags: [...record.tags],
  tagsText: record.tags.join('、'),
  scenario: record.scenario,
  notes: record.notes,
  dirty: false,
})
