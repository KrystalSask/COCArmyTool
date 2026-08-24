import { useMemo, useState } from 'react'
import { CapacityStrip } from '../components/CapacityStrip'
import { CompositionPanel } from '../components/CompositionPanel'
import { CountEditor } from '../components/CountEditor'
import { HeroEditor } from '../components/HeroEditor'
import { RecordFields, fieldsFromRecord, parseTags } from '../components/RecordFields'
import { gameData, isSiegeMachine } from '../data/gameData'
import { createArmyLink, parseArmyLink } from '../domain/armyLink'
import { cloneComposition } from '../domain/composition'
import type { ArmyComposition, CountEntry } from '../domain/types'
import { EMPTY_COMPOSITION } from '../domain/types'
import { validateComposition } from '../domain/validation'
import { saveArmyRecord } from '../storage/armyDatabase'
import { copyText } from '../utils/clipboard'

const REGRESSION_LINK = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'

interface Props {
  initialComposition?: ArmyComposition
  onSaved: () => void
}

const mergeEntryKind = (existing: CountEntry[], changed: CountEntry[], siege: boolean) => [
  ...existing.filter((entry) => isSiegeMachine(entry.id) !== siege),
  ...changed,
]

export function CalculatorPage({ initialComposition, onSaved }: Props) {
  const [composition, setComposition] = useState(() => cloneComposition(initialComposition ?? EMPTY_COMPOSITION))
  const [fields, setFields] = useState(fieldsFromRecord())
  const [message, setMessage] = useState('')
  const validation = useMemo(() => validateComposition(composition), [composition])

  const setMainPart = (entries: CountEntry[], siege: boolean) => setComposition((current) => ({ ...current, troops: mergeEntryKind(current.troops, entries, siege) }))
  const setCastlePart = (entries: CountEntry[], siege: boolean) => setComposition((current) => ({ ...current, clanCastleTroops: mergeEntryKind(current.clanCastleTroops, entries, siege) }))

  const handleCopy = async () => {
    if (!validation.valid) return
    await copyText(createArmyLink(composition))
    setMessage('国服配兵链接已复制。')
  }

  const handleSave = async () => {
    await saveArmyRecord({
      name: fields.name,
      tags: parseTags(fields.tagsText),
      scenario: fields.scenario,
      notes: fields.notes,
      originalLink: validation.valid ? createArmyLink(composition) : '',
      composition,
    })
    setMessage(validation.valid ? '完整方案已保存。' : '草稿已保存；补全后才能导出。')
    onSaved()
  }

  return <main className="calculator-layout">
    <aside className="calculator-summary">
      <span className="eyebrow">18级大本营军队配置</span><h1>配兵计算器</h1>
      <p>所有容量和英雄配置满足要求后，复制按钮才会解锁。</p>
      <CapacityStrip capacities={validation.capacities} />
      <div className={`export-state ${validation.valid ? 'ready' : ''}`}>
        <strong>{validation.valid ? '配置完整，可以导出' : `还需处理 ${validation.issues.length} 项`}</strong>
        {!validation.valid && <ul>{validation.issues.slice(0, 8).map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>}
      </div>
      <button className="primary-button full-button" disabled={!validation.valid} onClick={handleCopy}>复制国服链接</button>
      <button className="secondary-button full-button" onClick={() => { setComposition(parseArmyLink(REGRESSION_LINK)); setMessage('已载入回归示例，可直接验证导出。') }}>载入完整示例</button>
      <button className="ghost-button full-button" onClick={() => { setComposition(cloneComposition(EMPTY_COMPOSITION)); setMessage('已清空计算器。') }}>清空配置</button>
      {message && <p className="status-message success">{message}</p>}
    </aside>

    <div className="calculator-workbench">
      <CountEditor title="主军队" description="总容量需要恰好达到 352。" items={gameData.troops} entries={composition.troops.filter((entry) => !isSiegeMachine(entry.id))} onChange={(entries) => setMainPart(entries, false)} />
      <CountEditor title="主法术" description="法术容量需要恰好达到 11。" items={gameData.spells} entries={composition.spells} onChange={(spells) => setComposition((current) => ({ ...current, spells }))} />
      <CountEditor title="攻城机器" description="需要选择合计 3 台。" items={gameData.siegeMachines} entries={composition.troops.filter((entry) => isSiegeMachine(entry.id))} onChange={(entries) => setMainPart(entries, true)} />
      <HeroEditor heroes={composition.heroes} onChange={(heroes) => setComposition((current) => ({ ...current, heroes }))} />
      <CountEditor title="援军兵种" description="兵种容量需要恰好达到 55。" items={gameData.troops} entries={composition.clanCastleTroops.filter((entry) => !isSiegeMachine(entry.id))} onChange={(entries) => setCastlePart(entries, false)} />
      <CountEditor title="援军法术" description="援军法术容量需要恰好达到 4。" items={gameData.spells} entries={composition.clanCastleSpells} onChange={(clanCastleSpells) => setComposition((current) => ({ ...current, clanCastleSpells }))} />
      <CountEditor title="援军攻城机器" description="需要选择合计 2 台。" items={gameData.siegeMachines} entries={composition.clanCastleTroops.filter((entry) => isSiegeMachine(entry.id))} onChange={(entries) => setCastlePart(entries, true)} />
      <section className="form-card">
        <div className="section-title"><div><span className="eyebrow">完整方案或草稿</span><h2>保存当前配置</h2></div>
          <span className={`validation-badge ${validation.valid ? 'valid' : 'warning'}`}>{validation.valid ? '完整方案' : '未完成草稿'}</span></div>
        <RecordFields value={fields} onChange={setFields} idPrefix="calculator" />
        <button className="primary-button" onClick={handleSave}>保存当前配置</button>
      </section>
      <CompositionPanel composition={composition} title={fields.name || '当前配置预览'} />
    </div>
  </main>
}
