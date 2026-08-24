import { gameData } from '../data/gameData'
import { replaceHeroAt } from '../domain/composition'
import type { HeroLoadout } from '../domain/types'
import { ACTIVE_HERO_SLOTS, WARDEN_ID } from '../domain/validation'
import { GameIcon } from './GameIcon'

interface Props {
  heroes: HeroLoadout[]
  onChange: (heroes: HeroLoadout[]) => void
}

const emptyHero = (heroId = gameData.heroes[0].id): HeroLoadout => ({ heroId, equipmentIds: [] })

export function HeroEditor({ heroes, onChange }: Props) {
  const slots = Array.from({ length: ACTIVE_HERO_SLOTS }, (_, index) => heroes[index] ?? emptyHero())
  const update = (index: number, next: HeroLoadout) => onChange(replaceHeroAt(slots, index, next))

  return <section className="editor-section">
    <div className="editor-title"><div><h3>出战英雄</h3><p>配置 4 位英雄，每位需要一只宠物和两件对应装备。</p></div></div>
    <div className="hero-editor-grid">
      {slots.map((hero, index) => {
        const heroItem = gameData.heroById.get(hero.heroId)
        const petItem = hero.petId === undefined ? undefined : gameData.petById.get(hero.petId)
        const allowedEquipment = gameData.equipment.filter((item) => item.hero === heroItem?.name)
        return <article className="hero-editor-card" key={index}>
          <span className="slot-number">槽位 {index + 1}</span>
          <div className="hero-editor-visual">
            <GameIcon item={heroItem} className="hero-editor-portrait" />
            <div className="hero-editor-loadout-icons">
              <GameIcon item={petItem} className="loadout-icon pet-icon" />
              {[0, 1].map((equipmentIndex) => <GameIcon key={equipmentIndex} item={gameData.equipmentById.get(hero.equipmentIds[equipmentIndex])} className="loadout-icon" />)}
            </div>
          </div>
          <label>英雄<select value={hero.heroId} onChange={(event) => {
            const heroId = Number(event.target.value)
            update(index, { heroId, equipmentIds: [], ...(heroId === WARDEN_ID ? { mode: 0 } : {}) })
          }}>{gameData.heroes.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>
          {hero.heroId === WARDEN_ID && <label>模式<select value={hero.mode ?? ''} onChange={(event) => update(index, { ...hero, mode: Number(event.target.value) })}>
            <option value="" disabled>请选择</option><option value="0">地面模式</option><option value="1">空中模式</option>
          </select></label>}
          <label>宠物<select value={hero.petId ?? ''} onChange={(event) => update(index, { ...hero, petId: Number(event.target.value) })}>
            <option value="" disabled>请选择宠物</option>{gameData.pets.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}
          </select></label>
          {[0, 1].map((equipmentIndex) => <label key={equipmentIndex}>装备 {equipmentIndex + 1}<select value={hero.equipmentIds[equipmentIndex] ?? ''} onChange={(event) => {
            const nextEquipment = [...hero.equipmentIds]
            nextEquipment[equipmentIndex] = Number(event.target.value)
            update(index, { ...hero, equipmentIds: nextEquipment.filter(Number.isFinite) })
          }}><option value="" disabled>请选择装备</option>{allowedEquipment.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>)}
        </article>
      })}
    </div>
  </section>
}
