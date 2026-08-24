import type { ArmyComposition, HeroLoadout, ItemKind } from '../domain/types'

export type RecognitionLayout = 'saved' | 'edit' | 'attack' | 'unknown'

export type ScreenshotDeviceProfile = 'iphone-17' | 'ipad-pro-2024-11' | 'generic-landscape' | 'unknown'

export type RecognitionRegionKind =
  | 'heroes'
  | 'mainTroops'
  | 'mainSpells'
  | 'mainSiege'
  | 'castleArmy'

export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutRegion {
  kind: RecognitionRegionKind
  label: string
  rect: NormalizedRect
  allowedKinds: ItemKind[]
}

export interface LayoutAnchor {
  key: 'armyCapacity' | 'spellCapacity' | 'siegeCapacity' | 'castleTroops' | 'castleSpells' | 'castleSiege' | 'closeButton' | 'layoutControl'
  label: string
  rect: NormalizedRect
}

export interface RecognitionLayoutDefinition {
  kind: Exclude<RecognitionLayout, 'unknown'>
  label: string
  panel: NormalizedRect
  modeMarker: NormalizedRect
  anchors: LayoutAnchor[]
  regions: LayoutRegion[]
}

export interface ItemCandidate {
  id: number
  kind: ItemKind
  score: number
}

export interface CountCandidate {
  value: number
  score: number
}

export interface RecognizedCard {
  key: string
  region: Exclude<RecognitionRegionKind, 'heroes'>
  rect: NormalizedRect
  selectedId: number
  selectedKind: 'troop' | 'siege' | 'spell'
  count: number
  itemCandidates: ItemCandidate[]
  countCandidates: CountCandidate[]
  confidence: number
  confirmed: boolean
  ignoreLevel: true
  issue?: string
}

export interface ModeEvidence {
  value?: 0 | 1
  score: number
  confirmed: boolean
}

export interface RecognizedHeroSlot {
  key: string
  rect: NormalizedRect
  loadout: HeroLoadout
  equipmentScores: number[]
  petScore: number
  mode: ModeEvidence
  confidence: number
  confirmed: boolean
  inference: 'equipment-owner' | 'conflict' | 'incomplete'
  issue?: string
}

export interface ScreenshotPreflight {
  fileName: string
  mimeType: string
  width: number
  height: number
  aspectRatio: number
  sha256: string
  layout: RecognitionLayout
  layoutConfidence: number
  deviceProfile: ScreenshotDeviceProfile
  panel: NormalizedRect
  panelConfidence: number
  panelSource: 'automatic' | 'profile' | 'manual'
  woodPixelRatio: number
  complete: boolean
  issues: string[]
}

export interface ScreenshotRecognitionResult {
  engine: 'mock' | 'visual'
  layout: RecognitionLayout
  panel: NormalizedRect
  anchors: LayoutAnchor[]
  regions: LayoutRegion[]
  cards: RecognizedCard[]
  heroes: RecognizedHeroSlot[]
  warnings: string[]
  createdAt: string
}

export interface RecognitionReview {
  result: ScreenshotRecognitionResult
  composition: ArmyComposition
  unresolvedKeys: string[]
}

export interface ScreenshotRecognitionEngine {
  readonly id: string
  recognize(file: File, preflight: ScreenshotPreflight): Promise<ScreenshotRecognitionResult>
}
