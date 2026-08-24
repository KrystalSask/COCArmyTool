import { getLayoutDefinition, projectLayoutToPanel, recognitionLayouts } from './layouts'
import type { ScreenshotVisualAnalysis } from './cardAnalysis'
import type { NormalizedRect, RecognizedCard, RecognizedHeroSlot, ScreenshotPreflight, ScreenshotRecognitionResult } from './types'

const unionRects = (rects: NormalizedRect[]): NormalizedRect => {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const createVisualRecognitionResult = (preflight: ScreenshotPreflight, analysis: ScreenshotVisualAnalysis): ScreenshotRecognitionResult => {
  const layout = preflight.layout === 'unknown' ? 'edit' : preflight.layout
  const definition = getLayoutDefinition(layout) ?? recognitionLayouts.edit
  const projected = projectLayoutToPanel(definition, preflight.panel)
  const warnings: string[] = []
  const cards: RecognizedCard[] = analysis.regions.flatMap((region) => region.slots.flatMap((slot, index) => {
    const selected = slot.candidates?.[0]
    const count = slot.count?.value
    if (!selected || count === undefined) {
      warnings.push(`${region.label}第 ${index + 1} 张卡片缺少可用候选或数量，未加入结果。`)
      return []
    }
    const confidence = Math.min(selected.score, slot.count?.confidence ?? 0, slot.badgeConfidence)
    return [{
      key: `${region.region}-${index}`,
      region: region.region,
      rect: slot.rect,
      selectedId: selected.id,
      selectedKind: selected.kind,
      count,
      itemCandidates: slot.candidates ?? [],
      countCandidates: [{ value: count, score: slot.count?.confidence ?? 0 }],
      confidence,
      confirmed: false,
      ignoreLevel: true as const,
      issue: '真实识别候选：请核对单位与数量后确认。',
    }]
  }))
  const heroes: RecognizedHeroSlot[] = analysis.heroes.flatMap((column) => {
    const equipmentIds = column.equipment.map((item) => item.candidates[0]?.id)
    const petId = column.pet.candidates[0]?.id
    if (column.heroId === undefined || equipmentIds.some((id) => id === undefined) || petId === undefined) {
      warnings.push(`英雄列 ${column.index + 1} 的装备归属或战宠尚未确定。`)
      return []
    }
    const equipmentScores = column.equipment.map((item) => item.candidates[0]?.score ?? 0)
    const petScore = column.pet.candidates[0]?.score ?? 0
    const modeCandidate = column.mode?.candidates[0]
    const confidence = Math.min(...equipmentScores, petScore, ...(column.heroId === 2 ? [modeCandidate?.score ?? 0] : []))
    return [{
      key: `hero-${column.index}`,
      rect: unionRects([...column.equipment.map((item) => item.rect), column.pet.rect]),
      loadout: {
        heroId: column.heroId,
        petId,
        equipmentIds: equipmentIds as number[],
        ...(column.heroId === 2 && modeCandidate ? { mode: modeCandidate.value } : {}),
      },
      equipmentScores,
      petScore,
      mode: column.heroId === 2
        ? { value: modeCandidate?.value, score: modeCandidate?.score ?? 0, confirmed: false }
        : { score: 1, confirmed: true },
      confidence,
      confirmed: false,
      inference: 'equipment-owner' as const,
      issue: '英雄由两件装备共同归属推断；请核对战宠、装备与模式。',
    }]
  })
  return {
    engine: 'visual',
    layout,
    panel: projected.panel,
    anchors: projected.anchors,
    regions: projected.regions,
    cards,
    heroes,
    warnings: [
      '当前为本地真实视觉候选；所有项目默认未确认，容量与链接回环检查通过前不会允许导出。',
      ...warnings,
    ],
    createdAt: new Date().toISOString(),
  }
}
