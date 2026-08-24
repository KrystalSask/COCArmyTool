import type { CapacitySummary } from '../domain/types'
import { LIMITS } from '../domain/validation'

interface Props {
  capacities: CapacitySummary
  compact?: boolean
}

const capacityItems: Array<{ key: keyof CapacitySummary, label: string, icon: string }> = [
  { key: 'army', label: '军队容量', icon: '⚔' },
  { key: 'spells', label: '法术容量', icon: '◈' },
  { key: 'siegeMachines', label: '攻城机器', icon: '▣' },
  { key: 'clanCastleTroops', label: '援军容量', icon: '♜' },
  { key: 'clanCastleSiegeMachines', label: '援军攻城机器', icon: '▤' },
  { key: 'clanCastleSpells', label: '援军法术', icon: '✦' },
]

export function CapacityStrip({ capacities, compact = false }: Props) {
  return <div className={`capacity-strip ${compact ? 'compact' : ''}`}>
    {capacityItems.map(({ key, label, icon }) => {
      const complete = capacities[key] === LIMITS[key]
      const over = capacities[key] > LIMITS[key]
      return <div className={`capacity-pill ${complete ? 'complete' : ''} ${over ? 'over' : ''}`} key={key}>
        <span className="capacity-icon">{icon}</span>
        <span><small>{label}</small><strong>{capacities[key]}/{LIMITS[key]}</strong></span>
      </div>
    })}
  </div>
}
