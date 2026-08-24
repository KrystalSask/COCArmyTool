import type { NormalizedRect, RecognitionLayout, RecognitionLayoutDefinition } from './types'

// All anchors and regions are relative to the detected army panel, not the full screenshot.
const commonPanel = { x: 0, y: 0, width: 1, height: 1 }

const commonRegions: RecognitionLayoutDefinition['regions'] = [
  { kind: 'heroes', label: '英雄、战宠与装备', rect: { x: .009, y: .209, width: .412, height: .736 }, allowedKinds: ['hero', 'pet', 'equipment'] },
  { kind: 'mainTroops', label: '主军队', rect: { x: .432, y: .235, width: .55, height: .16 }, allowedKinds: ['troop'] },
  { kind: 'mainSpells', label: '主法术', rect: { x: .432, y: .516, width: .34, height: .15 }, allowedKinds: ['spell'] },
  { kind: 'mainSiege', label: '攻城机器', rect: { x: .79, y: .516, width: .19, height: .15 }, allowedKinds: ['siege'] },
  { kind: 'castleArmy', label: '部落城堡援军（混排）', rect: { x: .432, y: .803, width: .55, height: .15 }, allowedKinds: ['troop', 'siege', 'spell'] },
]

const commonAnchors: RecognitionLayoutDefinition['anchors'] = [
  { key: 'armyCapacity', label: '352/352', rect: { x: .404, y: .170, width: .10, height: .055 } },
  { key: 'spellCapacity', label: '11/11', rect: { x: .409, y: .423, width: .077, height: .055 } },
  { key: 'siegeCapacity', label: '3/3', rect: { x: .768, y: .423, width: .071, height: .055 } },
  { key: 'castleTroops', label: '55/55', rect: { x: .409, y: .681, width: .082, height: .055 } },
  { key: 'castleSpells', label: '4/4', rect: { x: .527, y: .681, width: .065, height: .055 } },
  { key: 'castleSiege', label: '2/2', rect: { x: .615, y: .681, width: .065, height: .055 } },
  { key: 'closeButton', label: '关闭按钮', rect: { x: .933, y: .005, width: .05, height: .085 } },
  { key: 'layoutControl', label: '页面类型控件', rect: { x: .004, y: .005, width: .33, height: .10 } },
]

export const recognitionLayouts: Record<Exclude<RecognitionLayout, 'unknown'>, RecognitionLayoutDefinition> = {
  saved: {
    kind: 'saved',
    label: '我的军队 / 已保存配置',
    panel: commonPanel,
    modeMarker: { x: .168, y: .225, width: .041, height: .055 },
    anchors: commonAnchors,
    regions: commonRegions,
  },
  edit: {
    kind: 'edit',
    label: '编辑导入的军队配置',
    panel: commonPanel,
    modeMarker: { x: .168, y: .225, width: .041, height: .055 },
    anchors: commonAnchors,
    regions: commonRegions,
  },
  attack: {
    kind: 'attack',
    label: '准备进攻 / 进攻确认',
    panel: commonPanel,
    modeMarker: { x: .168, y: .225, width: .041, height: .055 },
    anchors: commonAnchors,
    regions: commonRegions,
  },
}

export const getLayoutDefinition = (layout: RecognitionLayout) => layout === 'unknown' ? undefined : recognitionLayouts[layout]

export const projectRectToPanel = (rect: NormalizedRect, panel: NormalizedRect): NormalizedRect => ({
  x: panel.x + rect.x * panel.width,
  y: panel.y + rect.y * panel.height,
  width: rect.width * panel.width,
  height: rect.height * panel.height,
})

export const projectLayoutToPanel = (definition: RecognitionLayoutDefinition, panel: NormalizedRect) => ({
  panel,
  modeMarker: projectRectToPanel(definition.modeMarker, panel),
  anchors: definition.anchors.map((anchor) => ({ ...anchor, rect: projectRectToPanel(anchor.rect, panel) })),
  regions: definition.regions.map((region) => ({ ...region, rect: projectRectToPanel(region.rect, panel) })),
})

export const rectStyle = (rect: { x: number, y: number, width: number, height: number }) => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
})
