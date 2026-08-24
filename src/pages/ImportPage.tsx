import { useState } from 'react'
import { CompositionPanel } from '../components/CompositionPanel'
import { RecordFields, fieldsFromRecord, parseTags } from '../components/RecordFields'
import { createArmyLink, parseArmyLink } from '../domain/armyLink'
import type { ArmyComposition } from '../domain/types'
import { validateComposition } from '../domain/validation'
import { saveArmyRecord } from '../storage/armyDatabase'
import { copyText } from '../utils/clipboard'

interface Props {
  onSaved: () => void
  onEditInCalculator: (composition: ArmyComposition) => void
}

export function ImportPage({ onSaved, onEditInCalculator }: Props) {
  const [input, setInput] = useState('')
  const [composition, setComposition] = useState<ArmyComposition | null>(null)
  const [fields, setFields] = useState(fieldsFromRecord())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleImport = () => {
    try {
      const parsed = parseArmyLink(input)
      setComposition(parsed)
      setError('')
      setMessage('链接解析成功，已还原完整配置。')
    } catch (reason) {
      setComposition(null)
      setMessage('')
      setError(reason instanceof Error ? reason.message : '无法解析该链接')
    }
  }

  const handleSave = async () => {
    if (!composition) return
    await saveArmyRecord({
      name: fields.name,
      tags: parseTags(fields.tagsText),
      scenario: fields.scenario,
      notes: fields.notes,
      originalLink: input.trim(),
      composition,
    })
    setMessage('方案已保存到本机方案库。')
    onSaved()
  }

  const validation = composition ? validateComposition(composition) : null

  return <main className="page-stack">
    <section className="intro-card import-card">
      <div><span className="eyebrow">国服配兵链接</span><h1>导入军队配置</h1>
        <p>粘贴游戏分享的 CopyArmy 链接，助手会还原主军、援军、英雄、宠物与装备。</p></div>
      <textarea aria-label="配兵链接" value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://link.clashofclans.com/cn?action=CopyArmy&army=..." rows={4} />
      <div className="button-row"><button className="primary-button" onClick={handleImport}>解析链接</button>
        <button className="ghost-button" onClick={() => { setInput(''); setComposition(null); setError(''); setMessage('') }}>清空</button></div>
      {message && <p className="status-message success">{message}</p>}
      {error && <p className="status-message error">{error}</p>}
    </section>

    {composition && <>
      <CompositionPanel composition={composition} title={fields.name || '导入的军队配置'} />
      <section className="form-card">
        <div className="section-title"><div><span className="eyebrow">保存到本机</span><h2>保存方案</h2></div>
          <span className={`validation-badge ${validation?.valid ? 'valid' : 'warning'}`}>{validation?.valid ? '满足18本导出条件' : `可保存 · ${validation?.issues.length} 项待补全`}</span>
        </div>
        <RecordFields value={fields} onChange={setFields} idPrefix="import" />
        <div className="button-row">
          <button className="primary-button" onClick={handleSave}>保存到方案库</button>
          <button className="secondary-button" onClick={() => onEditInCalculator(composition)}>在计算器中编辑</button>
          <button className="ghost-button" disabled={!validation?.valid} title={validation?.valid ? '复制规范化国服链接' : '补全配置后才能复制'} onClick={() => copyText(createArmyLink(composition)).then(() => setMessage('已复制规范化国服链接。')).catch((reason) => setError(String(reason)))}>复制链接</button>
        </div>
      </section>
    </>}
  </main>
}
