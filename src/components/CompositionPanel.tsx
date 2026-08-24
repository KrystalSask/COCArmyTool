import { gameData, isSiegeMachine } from '../data/gameData'
import { calculateCapacities } from '../domain/validation'
import type { ArmyComposition, CountEntry, GameItem } from '../domain/types'
import { CapacityStrip } from './CapacityStrip'
import { GameIcon } from './GameIcon'

interface Props {
  composition: ArmyComposition
  title?: string
  showEmpty?: boolean
}

function ItemCard({ item, count }: { item?: GameItem, count: number }) {
  const name = item?.displayName ?? '未知单位'
  return <div className={`army-card kind-${item?.kind ?? 'unknown'}`} title={item?.name}>
    <span className="army-card-count">×{count}</span>
    <GameIcon item={item} className="army-card-icon" decorative />
    <span className="army-card-name">{name}</span>
    {item && item.housingSpace > 0 && <span className="army-card-space">{item.housingSpace} 格</span>}
  </div>
}

function EntryRow({ title, entries, kind }: { title: string, entries: CountEntry[], kind: 'troop' | 'spell' | 'mixed' }) {
  const getItem = (id: number) => {
    if (kind === 'spell') return gameData.spellById.get(id)
    return gameData.troopById.get(id) ?? gameData.siegeById.get(id)
  }
  return <section className="composition-section">
    <h3>{title}</h3>
    <div className="army-card-row">
      {entries.length ? entries.map((entry) => <ItemCard key={`${kind}-${entry.id}`} item={getItem(entry.id)} count={entry.count} />) : <p className="empty-inline">暂无配置</p>}
    </div>
  </section>
}

function HeroesRow({ composition }: { composition: ArmyComposition }) {
  return <section className="composition-section hero-section">
    <h3>英雄、宠物与装备</h3>
    <div className="hero-loadout-row">
      {composition.heroes.length ? composition.heroes.map((loadout) => {
        const hero = gameData.heroById.get(loadout.heroId)
        const pet = loadout.petId === undefined ? undefined : gameData.petById.get(loadout.petId)
        return <article className="hero-loadout" key={loadout.heroId}>
          <GameIcon item={hero} className="hero-portrait" decorative />
          <div><strong>{hero?.displayName ?? `未知英雄 ${loadout.heroId}`}</strong>
            <span>{loadout.heroId === 2 ? `模式：${loadout.mode === 1 ? '空中' : loadout.mode === 0 ? '地面' : '未选'}` : '出战'}</span>
          </div>
          <div className="hero-accessories">
            <span className="accessory-chip" title={pet?.displayName ?? '未配置战宠'}><GameIcon item={pet} decorative /><small>{pet?.displayName ?? '未配置'}</small></span>
            {loadout.equipmentIds.map((id) => {
              const equipment = gameData.equipmentById.get(id)
              return <span className="accessory-chip" key={id} title={equipment?.displayName ?? `#${id}`}><GameIcon item={equipment} decorative /><small>{equipment?.displayName ?? `#${id}`}</small></span>
            })}
          </div>
        </article>
      }) : <p className="empty-inline">暂无英雄配置</p>}
    </div>
  </section>
}

export function CompositionPanel({ composition, title = '军队配置', showEmpty = true }: Props) {
  const mainTroops = composition.troops.filter((entry) => !isSiegeMachine(entry.id))
  const siege = composition.troops.filter((entry) => isSiegeMachine(entry.id))
  const castleTroops = composition.clanCastleTroops.filter((entry) => !isSiegeMachine(entry.id))
  const castleSiege = composition.clanCastleTroops.filter((entry) => isSiegeMachine(entry.id))
  const hasAnything = composition.heroes.length + composition.troops.length + composition.spells.length + composition.clanCastleTroops.length + composition.clanCastleSpells.length > 0

  if (!hasAnything && !showEmpty) return null
  return <div className="composition-panel">
    <div className="composition-heading">
      <div><span className="eyebrow">18级大本营 · 家乡村庄</span><h2>{title}</h2></div>
      <CapacityStrip capacities={calculateCapacities(composition)} />
    </div>
    <div className="main-army-zone">
      <EntryRow title="部队" entries={mainTroops} kind="troop" />
      <EntryRow title="法术" entries={composition.spells} kind="spell" />
      <EntryRow title="攻城机器" entries={siege} kind="mixed" />
    </div>
    <div className="loadout-zone"><HeroesRow composition={composition} />
    <div className="castle-zone">
      <EntryRow title="部落城堡部队" entries={castleTroops} kind="troop" />
      <EntryRow title="部落城堡法术" entries={composition.clanCastleSpells} kind="spell" />
      <EntryRow title="部落城堡攻城机器" entries={castleSiege} kind="mixed" />
    </div></div>
  </div>
}
