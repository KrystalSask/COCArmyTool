import { useRef, useState } from 'react'
import { CompositionPanel } from '../components/CompositionPanel'
import { RecordFields, fieldsFromRecord, parseTags } from '../components/RecordFields'
import { featuredArmies, isFeaturedArmyFresh, type FeaturedArmy } from '../data/featuredArmies'
import { createArmyLink } from '../domain/armyLink'
import type { ArmyComposition, ArmyRecord } from '../domain/types'
import { validateComposition } from '../domain/validation'
import { deleteArmyRecord, saveArmyRecord } from '../storage/armyDatabase'
import { createArmyBackup, importArmyBackup, parseArmyBackup } from '../storage/armyBackup'
import { copyText } from '../utils/clipboard'

interface Props {
  records: ArmyRecord[]
  onChanged: () => void
  onEditRecord: (record: ArmyRecord) => void
  onEditComposition: (composition: ArmyComposition) => void
}

const featuredKey = (id: string) => `featured:${id}`
const recordKey = (id: string) => `record:${id}`

function FeaturedCard({ army, active, onSelect }: { army: FeaturedArmy, active: boolean, onSelect: () => void }) {
  const fresh = isFeaturedArmyFresh(army)
  return <article className={`record-card featured-card ${active ? 'active' : ''}`} onClick={onSelect}>
    <div className="record-card-top"><div><span className="scenario-tag">18 本热门 · {army.difficulty}</span><h2>{army.name}</h2></div><span className={`freshness-badge ${fresh ? '' : 'expired'}`}>{fresh ? '近30天' : '待复核'}</span></div>
    <div className="tag-row">{army.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
    <p>{army.summary}</p>
    <time>{army.sourceName} · 发布于 {army.publishedAt}</time>
  </article>
}

export function LibraryPage({ records, onChanged, onEditRecord, onEditComposition }: Props) {
  const backupInputRef = useRef<HTMLInputElement>(null)
  const [selectedKey, setSelectedKey] = useState(featuredKey(featuredArmies[0].id))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fields, setFields] = useState(fieldsFromRecord())
  const [message, setMessage] = useState('')
  const selectedFeatured = featuredArmies.find((army) => selectedKey === featuredKey(army.id)) ?? null
  const selectedRecord = records.find((record) => selectedKey === recordKey(record.id)) ?? null

  const startEditing = (record: ArmyRecord) => {
    setSelectedKey(recordKey(record.id))
    setEditingId(record.id)
    setFields(fieldsFromRecord(record))
  }

  const saveMetadata = async () => {
    const record = records.find((item) => item.id === editingId)
    if (!record) return
    await saveArmyRecord({
      ...record,
      name: fields.name,
      tags: parseTags(fields.tagsText),
      scenario: fields.scenario,
      notes: fields.notes,
    })
    setEditingId(null)
    setMessage('方案信息已更新。')
    onChanged()
  }

  const saveFeatured = async (army: FeaturedArmy) => {
    const record = await saveArmyRecord({
      name: army.name,
      tags: [...army.tags, '内置热门'],
      scenario: '联赛',
      notes: `${army.summary}\n来源：${army.sourceName}（${army.publishedAt}）`,
      originalLink: createArmyLink(army.composition, 'en'),
      composition: army.composition,
    })
    setSelectedKey(recordKey(record.id))
    setMessage('已保存副本到“我的方案”。')
    onChanged()
  }

  const remove = async (record: ArmyRecord) => {
    if (!window.confirm(`确定删除“${record.name}”吗？此操作无法撤销。`)) return
    await deleteArmyRecord(record.id)
    if (selectedKey === recordKey(record.id)) setSelectedKey(featuredKey(featuredArmies[0].id))
    setMessage('方案已删除。')
    onChanged()
  }

  const copyComposition = async (composition: ArmyComposition) => {
    await copyText(createArmyLink(composition))
    setMessage('国服配兵链接已复制。')
  }

  const exportBackup = async () => {
    const backup = await createArmyBackup()
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `coc-army-tool-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
    URL.revokeObjectURL(url); setMessage(`已导出 ${backup.records.length} 个本地方案。`)
  }

  const importBackup = async (file: File) => {
    try {
      const report = await importArmyBackup(parseArmyBackup(await file.text()))
      setMessage(`导入完成：新增 ${report.inserted}，更新 ${report.updated}，副本 ${report.copied}，跳过 ${report.skipped}。`)
      onChanged()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '无法导入备份文件。') }
  }

  return <main className="page-stack">
    <section className="intro-card library-intro">
      <div><span className="eyebrow">18 本配兵数据库</span><h1>热门方案与我的方案</h1><p>内置 {featuredArmies.length} 套近 30 天创作者方案，均保留来源与日期；你的 {records.length} 套方案只保存在当前应用中，可通过 JSON 备份迁移。</p></div>
      <div className="button-row"><button className="secondary-button" onClick={() => void exportBackup()}>导出本地方案</button><button className="ghost-button" onClick={() => backupInputRef.current?.click()}>导入备份</button><input ref={backupInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = '' }} /></div>
    </section>
    {message && <p className="status-message success standalone-message">{message}</p>}
    <div className="library-grid">
      <div className="library-lists">
        <section className="library-list-section">
          <div className="library-section-title"><div><span className="eyebrow">项目内置</span><h2>近 30 天热门配兵</h2></div><small>采集于 2026-08-11</small></div>
          <div className="record-list">{featuredArmies.map((army) => <FeaturedCard key={army.id} army={army} active={selectedKey === featuredKey(army.id)} onSelect={() => { setSelectedKey(featuredKey(army.id)); setEditingId(null) }} />)}</div>
        </section>
        <section className="library-list-section">
          <div className="library-section-title"><div><span className="eyebrow">仅存本机</span><h2>我的方案</h2></div><small>{records.length} 套</small></div>
          {!records.length ? <div className="library-empty"><strong>还没有自建方案</strong><span>可复制一份热门方案，或从导入和计算器页面保存。</span></div> :
            <div className="record-list">{records.map((record) => {
              const validation = validateComposition(record.composition)
              return <article className={`record-card ${selectedKey === recordKey(record.id) ? 'active' : ''}`} key={record.id} onClick={() => { setSelectedKey(recordKey(record.id)); setEditingId(null) }}>
                <div className="record-card-top"><div><span className="scenario-tag">{record.scenario}</span><h2>{record.name}</h2></div><span className={`dot ${validation.valid ? 'valid' : ''}`} title={validation.valid ? '配置完整' : '草稿'} /></div>
                <div className="tag-row">{record.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                <p>{record.notes || '暂无备注'}</p>
                <time>{new Date(record.updatedAt).toLocaleString('zh-CN')}</time>
                <div className="record-actions">
                  <button onClick={(event) => { event.stopPropagation(); startEditing(record) }}>编辑信息</button>
                  <button onClick={(event) => { event.stopPropagation(); onEditRecord(record) }}>继续编辑</button>
                  <button className="danger-link" onClick={(event) => { event.stopPropagation(); void remove(record) }}>删除</button>
                </div>
              </article>
            })}</div>}
        </section>
      </div>
      <div className="record-detail">
        {selectedFeatured && <>
          <section className="featured-source-card">
            <div><span className="eyebrow">{selectedFeatured.archetype}</span><h2>{selectedFeatured.name}</h2><p>{selectedFeatured.summary}</p></div>
            <dl><div><dt>作者</dt><dd>{selectedFeatured.sourceName}</dd></div><div><dt>发布日期</dt><dd>{selectedFeatured.publishedAt}</dd></div><div><dt>有效期</dt><dd>至 {selectedFeatured.expiresAt}</dd></div></dl>
            {selectedFeatured.metaEvidence && <p className="meta-evidence">热门依据：{selectedFeatured.metaEvidence}</p>}
            <p className="compatibility-note">兼容说明：作者原链接仅配置实际使用的攻城机器；国服导出按项目容量规则，用同款机器补齐 3 个自带与 2 个援军备选位，主力部队、法术与英雄配置未改动。</p>
            <div className="detail-actions">
              <button className="primary-button" onClick={() => void copyComposition(selectedFeatured.composition)}>复制国服链接</button>
              <button className="secondary-button" onClick={() => onEditComposition(selectedFeatured.composition)}>在编辑器中调整</button>
              <button className="ghost-button" onClick={() => void saveFeatured(selectedFeatured)}>保存到我的方案</button>
              <a className="source-link" href={selectedFeatured.sourceUrl} target="_blank" rel="noreferrer">查看作者原文 ↗</a>
              <a className="source-link" href={selectedFeatured.sourceArmyLink} target="_blank" rel="noreferrer">作者原始配兵 ↗</a>
            </div>
          </section>
          <CompositionPanel composition={selectedFeatured.composition} title={selectedFeatured.name} />
        </>}
        {selectedRecord && <>
          {editingId === selectedRecord.id ? <section className="form-card">
            <h2>编辑方案信息</h2><RecordFields value={fields} onChange={setFields} idPrefix="library" />
            <div className="button-row"><button className="primary-button" onClick={saveMetadata}>保存修改</button><button className="ghost-button" onClick={() => setEditingId(null)}>取消</button></div>
          </section> : <div className="detail-actions">
            <button className="primary-button" disabled={!validateComposition(selectedRecord.composition).valid} title={validateComposition(selectedRecord.composition).valid ? '复制国服链接' : '草稿补全后才能复制'} onClick={() => void copyComposition(selectedRecord.composition)}>复制链接</button>
            <button className="secondary-button" onClick={() => onEditRecord(selectedRecord)}>在编辑器中继续</button>
          </div>}
          <CompositionPanel composition={selectedRecord.composition} title={selectedRecord.name} />
        </>}
      </div>
    </div>
  </main>
}
