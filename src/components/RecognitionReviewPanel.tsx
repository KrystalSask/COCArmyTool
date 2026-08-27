import { gameData, itemByIdAndKind } from '../data/gameData'
import { heroEquipmentKey, heroPetKey, updateRecognizedCard, updateRecognizedHero, updateRecognizedHeroEquipment, updateRecognizedHeroMode, updateRecognizedHeroPet } from '../recognition/review'
import type { CardUnresolvedKind, HeroUnresolvedKind, RecognizedHeroSlot, ScreenshotRecognitionResult } from '../recognition/types'
import { WARDEN_ID } from '../domain/validation'
import { GameIcon } from './GameIcon'

interface Props {
  result: ScreenshotRecognitionResult
  activeKey?: string
  onActiveKey: (key: string) => void
  onChange: (result: ScreenshotRecognitionResult) => void
}

const regionLabels: Record<string, string> = {
  mainTroops: '主军队', mainSpells: '主法术', mainSiege: '攻城机器',
  castleArmy: '部落城堡援军',
}

const cardIssueLabels: Record<CardUnresolvedKind, string> = {
  'missing-count': '缺少数量',
  'low-confidence': '置信度低',
  validation: '规则校验',
  unconfirmed: '待确认',
}

const heroIssueLabels: Record<HeroUnresolvedKind, string> = {
  'incomplete-equipment': '装备不完整',
  'equipment-conflict': '装备归属冲突',
  'missing-pet': '缺少战宠',
  'low-confidence-pet': '战宠置信度低',
  'missing-mode': '缺少模式',
  unconfirmed: '待确认',
}

const confidenceClass = (confidence: number, confirmed: boolean) => confirmed ? 'confirmed' : confidence >= .8 ? 'medium' : 'low'

const heroEvidenceComplete = (hero: RecognizedHeroSlot) => hero.loadout.heroId !== undefined && hero.loadout.petId !== undefined
  && hero.loadout.equipmentIds.length === 2 && hero.loadout.equipmentIds.every((id) => id !== undefined)
  && (hero.loadout.heroId !== WARDEN_ID || hero.loadout.mode !== undefined)

// 列级键与子证据键都算命中：activeKey 可能指向整列或某一装备/战宠证据。
const heroActive = (hero: RecognizedHeroSlot, activeKey?: string) => activeKey === hero.key || Boolean(activeKey?.startsWith(`${hero.key}-`))

export function RecognitionReviewPanel({ result, activeKey, onActiveKey, onChange }: Props) {
  const confirmHero = (hero: RecognizedHeroSlot) => onChange(updateRecognizedHero(result, hero.key, {
    confirmed: true,
    issue: undefined,
    issueKind: undefined,
    mode: { ...hero.mode, confirmed: true },
  }))

  return <div className="recognition-review-stack">
    <section className="recognition-review-section">
      <div className="editor-title"><div><h3>卡片候选与数量</h3><p>等级区域始终忽略；黄色和红色项目必须确认。</p></div></div>
      <div className="recognized-card-grid">
        {result.cards.map((card) => {
          const item = itemByIdAndKind(card.selectedId, card.selectedKind)
          return <article className={`recognized-card ${confidenceClass(card.confidence, card.confirmed)} ${activeKey === card.key ? 'active' : ''}`} key={card.key} data-review-key={card.key}>
            <button className="recognized-card-main" type="button" onClick={() => onActiveKey(card.key)}>
              <GameIcon item={item} decorative />
              <span><small>{regionLabels[card.region]} · 第 {result.cards.filter((candidate) => candidate.region === card.region).indexOf(card) + 1} 张</small><strong>{item?.displayName ?? `#${card.selectedId}`}</strong><em>置信度 {Math.round(card.confidence * 100)}%</em></span>
            </button>
            {card.issueKind && <span className={`unresolved-badge ${card.issueKind}`}>{cardIssueLabels[card.issueKind]}</span>}
            <label className="recognized-count">数量<input type="number" min="1" placeholder="待填写" value={card.count ?? ''} onChange={(event) => {
              const count = Number(event.target.value)
              onChange(updateRecognizedCard(result, card.key, count >= 1
                ? { count, confirmed: true, issue: undefined, issueKind: undefined }
                : { count: undefined, confirmed: false, issue: '请填写有效数量后确认。' }))
            }} /></label>
            <div className="count-candidate-row">数量候选 {card.countCandidates.map((candidate) => <button type="button" className={candidate.value === card.count ? 'selected' : ''} key={candidate.value} onClick={() => onChange(updateRecognizedCard(result, card.key, { count: candidate.value, confirmed: true, issue: undefined, issueKind: undefined }))}>×{candidate.value} · {Math.round(candidate.score * 100)}%</button>)}</div>
            <div className="candidate-row" aria-label={`${item?.displayName ?? card.key}候选`}>
              {card.itemCandidates.map((candidate) => {
                const candidateItem = itemByIdAndKind(candidate.id, candidate.kind)
                return <button type="button" className={candidate.id === card.selectedId ? 'selected' : ''} key={`${candidate.kind}-${candidate.id}`} title={`${candidateItem?.displayName} ${Math.round(candidate.score * 100)}%`} onClick={() => onChange(updateRecognizedCard(result, card.key, {
                  selectedId: candidate.id,
                  selectedKind: candidate.kind as typeof card.selectedKind,
                  confirmed: true,
                  issue: undefined,
                  issueKind: undefined,
                }))}><GameIcon item={candidateItem} decorative /><span>{Math.round(candidate.score * 100)}%</span></button>
              })}
            </div>
            <div className="recognized-card-actions"><button type="button" onClick={() => onActiveKey(card.key)}>定位原图</button>
              {!card.confirmed && card.count !== undefined && <button type="button" className="confirm-link" onClick={() => onChange(updateRecognizedCard(result, card.key, { confirmed: true, issue: undefined, issueKind: undefined }))}>确认当前结果</button>}
            </div>
            {card.issue && <p>{card.issue}</p>}
          </article>
        })}
      </div>
    </section>

    <section className="recognition-review-section">
      <div className="editor-title"><div><h3>英雄装备归属推理</h3><p>不识别英雄皮肤；英雄仅由两件装备的共同归属确定。四列英雄始终保留，即使证据不完整。</p></div></div>
      <div className="recognized-hero-grid">
        {result.heroes.map((hero) => {
          const heroItem = hero.loadout.heroId === undefined ? undefined : gameData.heroById.get(hero.loadout.heroId)
          const pet = hero.loadout.petId === undefined ? undefined : gameData.petById.get(hero.loadout.petId)
          const complete = heroEvidenceComplete(hero)
          const active = heroActive(hero, activeKey)
          return <article className={`recognized-hero ${confidenceClass(hero.confidence, hero.confirmed)} ${active ? 'active' : ''}`} key={hero.key} data-review-key={hero.key}>
            <button type="button" className="recognized-hero-heading" onClick={() => onActiveKey(hero.key)}><GameIcon item={heroItem} decorative /><span><small>由装备归属推断</small><strong>{heroItem?.displayName ?? '英雄待确认'}</strong><em>{Math.round(hero.confidence * 100)}%</em></span></button>
            {hero.issueKind && <span className={`unresolved-badge ${hero.issueKind}`}>{heroIssueLabels[hero.issueKind]}</span>}
            {[0, 1].map((equipmentIndex) => {
              const evidence = hero.equipment?.[equipmentIndex]
              const selectedId = hero.loadout.equipmentIds[equipmentIndex]
              const evidenceKey = heroEquipmentKey(hero.key, equipmentIndex)
              return <div className={`hero-evidence-block ${activeKey === evidenceKey ? 'active' : ''}`} key={evidenceKey} data-review-key={evidenceKey}>
                <button type="button" className="hero-evidence-heading" onClick={() => onActiveKey(evidenceKey)}><span>装备 {equipmentIndex + 1}</span>{evidence && <span className="evidence-candidates-count">{evidence.candidates.length} 个候选</span>}</button>
                <label>选择装备<select value={selectedId ?? ''} onChange={(event) => onChange(updateRecognizedHeroEquipment(result, hero.key, equipmentIndex, Number(event.target.value)))}>
                  <option value="" disabled>{selectedId === undefined ? '未识别' : '请选择'}</option>
                  {gameData.heroes.map((owner) => <optgroup label={owner.displayName} key={owner.id}>{gameData.equipment.filter((equipment) => equipment.hero === owner.name).map((equipment) => <option value={equipment.id} key={equipment.id}>{equipment.displayName}</option>)}</optgroup>)}
                </select></label>
                {evidence && evidence.candidates.length > 0 && <div className="candidate-row" aria-label={`${hero.key} 装备 ${equipmentIndex + 1} 候选`}>
                  {evidence.candidates.map((candidate) => {
                    const candidateItem = gameData.equipmentById.get(candidate.id)
                    return <button type="button" className={candidate.id === selectedId ? 'selected' : ''} key={candidate.id} title={`${candidateItem?.displayName ?? `#${candidate.id}`} ${Math.round(candidate.score * 100)}%`} onClick={() => onChange(updateRecognizedHeroEquipment(result, hero.key, equipmentIndex, candidate.id))}><GameIcon item={candidateItem} decorative /><span>{Math.round(candidate.score * 100)}%</span></button>
                  })}
                </div>}
              </div>
            })}
            <div className={`hero-evidence-block ${activeKey === heroPetKey(hero.key) ? 'active' : ''}`} data-review-key={heroPetKey(hero.key)}>
              <button type="button" className="hero-evidence-heading" onClick={() => onActiveKey(heroPetKey(hero.key))}><span>战宠</span>{hero.pet && <span className="evidence-candidates-count">{hero.pet.candidates.length} 个候选</span>}</button>
              <label>选择战宠<select value={hero.loadout.petId ?? ''} onChange={(event) => onChange(updateRecognizedHeroPet(result, hero.key, Number(event.target.value)))}>
                <option value="" disabled>{hero.loadout.petId === undefined ? '未识别' : '请选择'}</option>
                {gameData.pets.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}
              </select></label>
              <div className="recognized-pet-preview"><GameIcon item={pet} decorative /><span>{pet?.displayName ?? '未选择'}</span></div>
              {hero.pet && hero.pet.candidates.length > 0 && <div className="candidate-row" aria-label={`${hero.key} 战宠候选`}>
                {hero.pet.candidates.map((candidate) => {
                  const candidateItem = gameData.petById.get(candidate.id)
                  return <button type="button" className={candidate.id === hero.loadout.petId ? 'selected' : ''} key={candidate.id} title={`${candidateItem?.displayName ?? `#${candidate.id}`} ${Math.round(candidate.score * 100)}%`} onClick={() => onChange(updateRecognizedHeroPet(result, hero.key, candidate.id))}><GameIcon item={candidateItem} decorative /><span>{Math.round(candidate.score * 100)}%</span></button>
                })}
              </div>}
            </div>
            {hero.loadout.heroId === WARDEN_ID && <label>大守护者模式<select value={hero.loadout.mode ?? ''} onChange={(event) => onChange(updateRecognizedHeroMode(result, hero.key, Number(event.target.value) as 0 | 1))}><option value="" disabled>请选择</option><option value="0">地面模式</option><option value="1">空中模式</option></select></label>}
            <div className="recognized-card-actions"><button type="button" onClick={() => onActiveKey(hero.key)}>定位原图</button>
              {!hero.confirmed && complete && <button type="button" className="confirm-link" onClick={() => confirmHero(hero)}>确认英雄配置</button>}
              {!complete && <span className="unresolved-hint">证据不完整，无法确认</span>}
            </div>
            {hero.issue && <p>{hero.issue}</p>}
          </article>
        })}
      </div>
    </section>
  </div>
}
