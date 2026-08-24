import { gameData, itemByIdAndKind } from '../data/gameData'
import { inferHeroFromEquipment } from '../recognition/heroInference'
import { updateRecognizedCard, updateRecognizedHero } from '../recognition/review'
import type { RecognizedHeroSlot, ScreenshotRecognitionResult } from '../recognition/types'
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

const confidenceClass = (confidence: number, confirmed: boolean) => confirmed ? 'confirmed' : confidence >= .8 ? 'medium' : 'low'

export function RecognitionReviewPanel({ result, activeKey, onActiveKey, onChange }: Props) {
  const updateHeroEquipment = (hero: RecognizedHeroSlot, equipmentIndex: number, equipmentId: number) => {
    const equipmentIds = [...hero.loadout.equipmentIds]
    equipmentIds[equipmentIndex] = equipmentId
    const inference = inferHeroFromEquipment(equipmentIds)
    const heroId = inference.heroId ?? hero.loadout.heroId
    const loadout = {
      ...hero.loadout,
      heroId,
      equipmentIds,
      ...(heroId === WARDEN_ID ? { mode: hero.loadout.mode } : { mode: undefined }),
    }
    onChange(updateRecognizedHero(result, hero.key, {
      loadout,
      confirmed: false,
      issue: inference.status === 'confirmed' ? '装备已修改，请重新确认英雄配置' : inference.message,
    }))
  }

  return <div className="recognition-review-stack">
    <section className="recognition-review-section">
      <div className="editor-title"><div><h3>卡片候选与数量</h3><p>等级区域始终忽略；黄色和红色项目必须确认。</p></div></div>
      <div className="recognized-card-grid">
        {result.cards.map((card) => {
          const item = itemByIdAndKind(card.selectedId, card.selectedKind)
          return <article className={`recognized-card ${confidenceClass(card.confidence, card.confirmed)} ${activeKey === card.key ? 'active' : ''}`} key={card.key}>
            <button className="recognized-card-main" type="button" onClick={() => onActiveKey(card.key)}>
              <GameIcon item={item} decorative />
              <span><small>{regionLabels[card.region]}</small><strong>{item?.displayName ?? `#${card.selectedId}`}</strong><em>置信度 {Math.round(card.confidence * 100)}%</em></span>
            </button>
            <label className="recognized-count">数量<input type="number" min="1" value={card.count} onChange={(event) => onChange(updateRecognizedCard(result, card.key, { count: Math.max(1, Number(event.target.value)), confirmed: true, issue: undefined }))} /></label>
            <div className="count-candidate-row">数量候选 {card.countCandidates.map((candidate) => <button type="button" className={candidate.value === card.count ? 'selected' : ''} key={candidate.value} onClick={() => onChange(updateRecognizedCard(result, card.key, { count: candidate.value, confirmed: true, issue: undefined }))}>×{candidate.value} · {Math.round(candidate.score * 100)}%</button>)}</div>
            <div className="candidate-row" aria-label={`${item?.displayName ?? card.key}候选`}>
              {card.itemCandidates.map((candidate) => {
                const candidateItem = itemByIdAndKind(candidate.id, candidate.kind)
                return <button type="button" className={candidate.id === card.selectedId ? 'selected' : ''} key={`${candidate.kind}-${candidate.id}`} title={`${candidateItem?.displayName} ${Math.round(candidate.score * 100)}%`} onClick={() => onChange(updateRecognizedCard(result, card.key, {
                  selectedId: candidate.id,
                  selectedKind: candidate.kind as typeof card.selectedKind,
                  confirmed: true,
                  issue: undefined,
                }))}><GameIcon item={candidateItem} decorative /><span>{Math.round(candidate.score * 100)}%</span></button>
              })}
            </div>
            <div className="recognized-card-actions"><button type="button" onClick={() => onActiveKey(card.key)}>定位原图</button>
              {!card.confirmed && <button type="button" className="confirm-link" onClick={() => onChange(updateRecognizedCard(result, card.key, { confirmed: true, issue: undefined }))}>确认当前结果</button>}
            </div>
            {card.issue && <p>{card.issue}</p>}
          </article>
        })}
      </div>
    </section>

    <section className="recognition-review-section">
      <div className="editor-title"><div><h3>英雄装备归属推理</h3><p>不识别英雄皮肤；英雄仅由两件装备的共同归属确定。</p></div></div>
      <div className="recognized-hero-grid">
        {result.heroes.map((hero) => {
          const heroItem = gameData.heroById.get(hero.loadout.heroId)
          const pet = hero.loadout.petId === undefined ? undefined : gameData.petById.get(hero.loadout.petId)
          return <article className={`recognized-hero ${confidenceClass(hero.confidence, hero.confirmed)} ${activeKey === hero.key ? 'active' : ''}`} key={hero.key}>
            <button type="button" className="recognized-hero-heading" onClick={() => onActiveKey(hero.key)}><GameIcon item={heroItem} decorative /><span><small>由装备归属推断</small><strong>{heroItem?.displayName}</strong><em>{Math.round(hero.confidence * 100)}%</em></span></button>
            <label>战宠<select value={hero.loadout.petId ?? ''} onChange={(event) => onChange(updateRecognizedHero(result, hero.key, { loadout: { ...hero.loadout, petId: Number(event.target.value) }, confirmed: false, issue: '战宠已修改，请重新确认' }))}>
              <option value="" disabled>请选择</option>{gameData.pets.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}
            </select></label>
            <div className="recognized-pet-preview"><GameIcon item={pet} decorative /><span>{pet?.displayName}</span></div>
            {[0, 1].map((equipmentIndex) => <label key={equipmentIndex}>装备 {equipmentIndex + 1}<select value={hero.loadout.equipmentIds[equipmentIndex] ?? ''} onChange={(event) => updateHeroEquipment(hero, equipmentIndex, Number(event.target.value))}>
              <option value="" disabled>请选择</option>{gameData.heroes.map((owner) => <optgroup label={owner.displayName} key={owner.id}>{gameData.equipment.filter((equipment) => equipment.hero === owner.name).map((equipment) => <option value={equipment.id} key={equipment.id}>{equipment.displayName}</option>)}</optgroup>)}
            </select></label>)}
            {hero.loadout.heroId === WARDEN_ID && <label>大守护者模式<select value={hero.loadout.mode ?? ''} onChange={(event) => onChange(updateRecognizedHero(result, hero.key, {
              loadout: { ...hero.loadout, mode: Number(event.target.value) },
              mode: { value: Number(event.target.value) as 0 | 1, score: 1, confirmed: true },
              confirmed: false,
              issue: '模式已修改，请重新确认',
            }))}><option value="" disabled>请选择</option><option value="0">地面模式</option><option value="1">空中模式</option></select></label>}
            <div className="recognized-card-actions"><button type="button" onClick={() => onActiveKey(hero.key)}>定位原图</button>
              {!hero.confirmed && <button type="button" className="confirm-link" onClick={() => onChange(updateRecognizedHero(result, hero.key, { confirmed: true, issue: undefined, mode: { ...hero.mode, confirmed: true } }))}>确认英雄配置</button>}
            </div>
            {hero.issue && <p>{hero.issue}</p>}
          </article>
        })}
      </div>
    </section>
  </div>
}
