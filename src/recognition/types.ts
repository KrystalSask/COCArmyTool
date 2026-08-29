import type { ArmyComposition, ItemKind } from '../domain/types'

export type RecognitionLayout = 'saved' | 'edit' | 'attack' | 'unknown'

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

export type PanelAnchorKind = 'close-button' | 'header' | 'divider' | 'hero-columns' | 'equipment-row' | 'panel-edge' | 'wood'

export interface PanelAnchorEvidence {
  kind: PanelAnchorKind
  rect: NormalizedRect
  score: number
}

export interface PanelCandidateDiagnostic {
  id: string
  panel: NormalizedRect
  source: 'close-button' | 'structure' | 'manual' | 'fallback'
  geometryScore: number
  anchorEvidence: PanelAnchorEvidence[]
  cardStructureScore?: number
  heroStructureScore?: number
  consistencyScore?: number
  totalScore?: number
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

export type CardUnresolvedKind = 'missing-count' | 'low-confidence' | 'validation' | 'unconfirmed'

export interface RecognizedCard {
  key: string
  region: Exclude<RecognitionRegionKind, 'heroes'>
  rect: NormalizedRect
  selectedId: number
  selectedKind: 'troop' | 'siege' | 'spell'
  count?: number
  itemCandidates: ItemCandidate[]
  countCandidates: CountCandidate[]
  confidence: number
  confirmed: boolean
  ignoreLevel: true
  issue?: string
  issueKind?: CardUnresolvedKind
  // 手动添加的卡片：没有真实截图矩形，覆盖层跳过渲染、“定位原图”不可用。
  manual?: true
}

export interface ModeEvidence {
  value?: 0 | 1
  score: number
  confirmed: boolean
}

export type HeroUnresolvedKind =
  | 'incomplete-equipment'
  | 'equipment-conflict'
  | 'duplicate-equipment'
  | 'duplicate-hero'
  | 'duplicate-pet'
  | 'missing-pet'
  | 'low-confidence-pet'
  | 'missing-mode'
  | 'unconfirmed'

// 部分完成的英雄行：heroId/petId/mode 可能尚未确定，equipmentIds 中可能
// 含有未识别的占位。只有全部字段就绪的列才会进入最终 ArmyComposition。
export interface RecognizedHeroLoadout {
  heroId?: number
  mode?: number
  petId?: number
  equipmentIds: Array<number | undefined>
}

export interface HeroItemEvidence {
  rect: NormalizedRect
  candidates: Array<{ id: number, score: number, source?: 'onnx' | 'template' }>
  selectedId?: number
  score: number
  recognition?: EquipmentRecognitionDiagnostic
}

export interface EquipmentRecognitionDiagnostic {
  source: 'onnx' | 'template'
  modelVersion?: string
  preprocessingVersion?: string
  inputRect: NormalizedRect
  templateTopCandidates?: Array<{ id: number, score: number }>
  modelTopCandidates?: Array<{ id: number, score: number }>
  agreement?: boolean
  ownerAgreement?: boolean
  scoreDelta?: number
}

export interface RecognizedHeroSlot {
  key: string
  rect: NormalizedRect
  loadout: RecognizedHeroLoadout
  equipmentScores: number[]
  petScore: number
  mode: ModeEvidence
  confidence: number
  confirmed: boolean
  inference: 'equipment-owner' | 'conflict' | 'incomplete'
  issue?: string
  issueKind?: HeroUnresolvedKind
  // 视觉引擎始终提供；模拟引擎等其他来源可以不填，UI 按缺失处理。
  equipment?: HeroItemEvidence[]
  pet?: HeroItemEvidence
  geometryScore?: number
  diagnostics?: string[]
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
  gameViewport?: NormalizedRect
  viewportConfidence?: number
  panel: NormalizedRect
  panelConfidence: number
  panelSource: 'automatic' | 'fallback' | 'manual'
  panelCandidates?: PanelCandidateDiagnostic[]
  panelSelectionGap?: number
  woodPixelRatio: number
  viewportPixels?: ImageData
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
