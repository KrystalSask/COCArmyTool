import { useMemo, useState } from 'react'
import { CapacityStrip } from '../components/CapacityStrip'
import { CompositionPanel } from '../components/CompositionPanel'
import { CountEditor } from '../components/CountEditor'
import { HeroEditor } from '../components/HeroEditor'
import { RecordFields, parseTags, type RecordFieldValue } from '../components/RecordFields'
import { gameData, isSiegeMachine } from '../data/gameData'
import { createArmyLink, parseArmyLink } from '../domain/armyLink'
import { cloneComposition } from '../domain/composition'
import type { CountEntry } from '../domain/types'
import { EMPTY_COMPOSITION } from '../domain/types'
import { validateComposition } from '../domain/validation'
import { saveArmyRecord } from '../storage/armyDatabase'
import type { EditorSession } from '../state/editorSession'
import { markEditorSessionDirty, markEditorSessionSaved } from '../state/editorSession'
import { copyText } from '../utils/clipboard'

const REGRESSION_LINK = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'
const sourceLabels: Record<EditorSession['source'], string> = { link: '链接导入', screenshot: '截图识别', manual: '手动创建', library: '方案库' }

interface Props { session: EditorSession; onChange: (session: EditorSession) => void; onSaved: () => void }
const mergeEntryKind = (existing: CountEntry[], changed: CountEntry[], siege: boolean) => [...existing.filter((entry) => isSiegeMachine(entry.id) !== siege), ...changed]

export function EditorPage({ session, onChange, onSaved }: Props) {
  const [message, setMessage] = useState('')
  const validation = useMemo(() => validateComposition(session.composition), [session.composition])
  const updateComposition = (composition: EditorSession['composition']) => onChange(markEditorSessionDirty(session, { composition }))
  const updateFields = (fields: RecordFieldValue) => onChange(markEditorSessionDirty(session, { name: fields.name, tags: parseTags(fields.tagsText), tagsText: fields.tagsText, scenario: fields.scenario, notes: fields.notes }))
  const fields: RecordFieldValue = { name: session.name, tagsText: session.tagsText, scenario: session.scenario, notes: session.notes }
  const setMainPart = (entries: CountEntry[], siege: boolean) => updateComposition({ ...session.composition, troops: mergeEntryKind(session.composition.troops, entries, siege) })
  const setCastlePart = (entries: CountEntry[], siege: boolean) => updateComposition({ ...session.composition, clanCastleTroops: mergeEntryKind(session.composition.clanCastleTroops, entries, siege) })
  const save = async () => {
    const record = await saveArmyRecord({ id: session.recordId, name: session.name, tags: session.tags, scenario: session.scenario, notes: session.notes, originalLink: validation.valid ? createArmyLink(session.composition) : session.originalLink ?? '', composition: session.composition })
    onChange(markEditorSessionSaved(session, record)); onSaved(); setMessage(validation.valid ? '完整方案已保存。' : '草稿已保存；补全后才能复制链接。')
  }
  const copy = async () => { if (!validation.valid) return; await copyText(createArmyLink(session.composition)); setMessage('国服配兵链接已复制。') }

  return <main className="calculator-layout">
    <aside className="calculator-summary"><span className="eyebrow">统一配兵编辑器 · 来源：{sourceLabels[session.source]}</span><h1>配兵编辑器</h1><p>{session.dirty ? '当前有未保存修改。' : session.recordId ? '当前方案已保存。' : '当前会话尚未保存。'}</p>
      <CapacityStrip capacities={validation.capacities} /><div className={`export-state ${validation.valid ? 'ready' : ''}`}><strong>{validation.valid ? '配置完整，可以复制链接' : `还需处理 ${validation.issues.length} 项`}</strong>{!validation.valid && <ul>{validation.issues.slice(0, 8).map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>}</div>
      <div className="editor-primary-actions"><button className="primary-button full-button" onClick={() => void save()}>保存{session.recordId ? '修改' : '方案'}</button><button className="secondary-button full-button" disabled={!validation.valid} onClick={() => void copy()}>复制国服链接</button></div>
      {!validation.valid && <p className="status-message warning">保存草稿不要求配置完整；复制链接前必须处理上方全部问题。</p>}
      <button className="ghost-button full-button" onClick={() => { updateComposition(parseArmyLink(REGRESSION_LINK)); setMessage('已载入回归示例。') }}>载入完整示例</button>
      <button className="ghost-button full-button" onClick={() => { updateComposition(cloneComposition(EMPTY_COMPOSITION)); setMessage('已清空当前配置。') }}>重置配兵</button>{message && <p className="status-message success">{message}</p>}
    </aside>
    <div className="calculator-workbench">
      <CountEditor title="主军队" description="总容量需要恰好达到 352。" items={gameData.troops} entries={session.composition.troops.filter((entry) => !isSiegeMachine(entry.id))} onChange={(entries) => setMainPart(entries, false)} />
      <CountEditor title="主法术" description="法术容量需要恰好达到 11。" items={gameData.spells} entries={session.composition.spells} onChange={(spells) => updateComposition({ ...session.composition, spells })} />
      <CountEditor title="攻城机器" description="需要选择合计 3 台。" items={gameData.siegeMachines} entries={session.composition.troops.filter((entry) => isSiegeMachine(entry.id))} onChange={(entries) => setMainPart(entries, true)} />
      <HeroEditor heroes={session.composition.heroes} onChange={(heroes) => updateComposition({ ...session.composition, heroes })} />
      <CountEditor title="援军兵种" description="兵种容量需要恰好达到 55。" items={gameData.troops} entries={session.composition.clanCastleTroops.filter((entry) => !isSiegeMachine(entry.id))} onChange={(entries) => setCastlePart(entries, false)} />
      <CountEditor title="援军法术" description="援军法术容量需要恰好达到 4。" items={gameData.spells} entries={session.composition.clanCastleSpells} onChange={(clanCastleSpells) => updateComposition({ ...session.composition, clanCastleSpells })} />
      <CountEditor title="援军攻城机器" description="需要选择合计 2 台。" items={gameData.siegeMachines} entries={session.composition.clanCastleTroops.filter((entry) => isSiegeMachine(entry.id))} onChange={(entries) => setCastlePart(entries, true)} />
      <section className="form-card"><div className="section-title"><div><span className="eyebrow">方案资料</span><h2>名称、场景与备注</h2></div><span className={`validation-badge ${validation.valid ? 'valid' : 'warning'}`}>{validation.valid ? '完整方案' : '未完成草稿'}</span></div><RecordFields value={fields} onChange={updateFields} idPrefix="editor" /></section>
      <CompositionPanel composition={session.composition} title={session.name || '当前配置预览'} />
    </div>
  </main>
}
