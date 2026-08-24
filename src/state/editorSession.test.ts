import { describe, expect, it } from 'vitest'
import { EMPTY_COMPOSITION } from '../domain/types'
import { createEditorSession, markEditorSessionDirty, markEditorSessionSaved } from './editorSession'

describe('统一编辑会话', () => {
  it('为四种来源建立隔离的配兵副本', () => {
    for (const source of ['link', 'screenshot', 'manual', 'library'] as const) {
      const session = createEditorSession({ source, composition: EMPTY_COMPOSITION })
      expect(session.source).toBe(source)
      expect(session.composition).not.toBe(EMPTY_COMPOSITION)
      expect(session.dirty).toBe(false)
    }
  })

  it('修改后标脏，保存后记录 id 并清除脏状态', () => {
    const dirty = markEditorSessionDirty(createEditorSession({ source: 'manual' }), { name: '测试方案', tagsText: '空军、稳定' })
    expect(dirty.dirty).toBe(true)
    const saved = markEditorSessionSaved(dirty, {
      id: 'record-1', name: '测试方案', tags: ['空军', '稳定'], scenario: '部落战', notes: '', originalLink: '', composition: EMPTY_COMPOSITION, createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
    })
    expect(saved.recordId).toBe('record-1')
    expect(saved.tagsText).toBe('空军、稳定')
    expect(saved.dirty).toBe(false)
  })
})
