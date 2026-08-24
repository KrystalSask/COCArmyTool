export type ItemKind = 'troop' | 'siege' | 'spell' | 'hero' | 'pet' | 'equipment'

export interface GameItem {
  id: number
  name: string
  displayName: string
  imagePath: string
  kind: ItemKind
  housingSpace: number
  townHall: number | null
  hero: string | null
  rarity: string | null
}

export interface CountEntry {
  id: number
  count: number
}

export interface HeroLoadout {
  heroId: number
  mode?: number
  petId?: number
  equipmentIds: number[]
}

export interface ArmyComposition {
  heroes: HeroLoadout[]
  clanCastleTroops: CountEntry[]
  clanCastleSpells: CountEntry[]
  troops: CountEntry[]
  spells: CountEntry[]
}

export interface CapacitySummary {
  army: number
  spells: number
  siegeMachines: number
  clanCastleTroops: number
  clanCastleSiegeMachines: number
  clanCastleSpells: number
}

export interface ValidationIssue {
  code: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  capacities: CapacitySummary
  issues: ValidationIssue[]
}

export type ArmyScenario = '部落战' | '联赛' | '打鱼' | '冲杯' | '练习' | '其他'

export interface ArmyRecord {
  id: string
  name: string
  tags: string[]
  scenario: ArmyScenario
  notes: string
  originalLink: string
  composition: ArmyComposition
  createdAt: string
  updatedAt: string
}

export const EMPTY_COMPOSITION: ArmyComposition = {
  heroes: [],
  clanCastleTroops: [],
  clanCastleSpells: [],
  troops: [],
  spells: [],
}
