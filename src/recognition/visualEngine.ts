import { getLayoutDefinition, projectLayoutToPanel, recognitionLayouts } from './layouts'
import type { ScreenshotVisualAnalysis } from './cardAnalysis'
import { inferHeroFromEquipment } from './heroInference'
import { heroUnresolvedFromEvidence } from './review'
import type { NormalizedRect, RecognizedCard, RecognizedHeroSlot, ScreenshotPreflight, ScreenshotRecognitionResult } from './types'
import { WARDEN_ID } from '../domain/validation'

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
  analysis.regions.forEach((region) => region.validation.issues.forEach((issue) => warnings.push(`${region.label}：${issue.message}`)))
  const cards: RecognizedCard[] = analysis.regions.flatMap((region) => region.slots.flatMap((slot, index) => {
    const selected = slot.candidates?.[0]
    const count = slot.count?.value
    if (!selected) {
      warnings.push(`${region.label}第 ${index + 1} 张卡片缺少可用类别候选，未加入结果。`)
      return []
    }
    const confidence = count === undefined
      ? Math.min(selected.score, slot.badgeConfidence, .35)
      : Math.min(selected.score, slot.count?.confidence ?? 0, slot.badgeConfidence)
    return [{
      key: `${region.region}-${index}`,
      region: region.region,
      rect: slot.rect,
      selectedId: selected.id,
      selectedKind: selected.kind,
      count,
      itemCandidates: slot.candidates ?? [],
      countCandidates: slot.count?.candidates?.slice(0, 3)
        ?? (count === undefined ? [] : [{ value: count, score: slot.count?.confidence ?? 0 }]),
      confidence,
      confirmed: false,
      ignoreLevel: true as const,
      issue: count === undefined
        ? '卡片类别已识别，但左上角数量未能自动识别；请填写数量后确认。'
        : slot.validationIssues?.[0] ?? '真实识别候选：请核对单位与数量后确认。',
      issueKind: count === undefined
        ? 'missing-count' as const
        : slot.validationIssues?.length ? 'validation' as const
        : confidence < .55 ? 'low-confidence' as const
        : 'unconfirmed' as const,
    }]
  }))
  // 四列英雄全部保留，即使装备、战宠或模式证据不完整；不完整列不会进入
  // 最终 ArmyComposition（见 compositionFromRecognition）。
  const heroes: RecognizedHeroSlot[] = analysis.heroes.map((column) => {
    const equipment = column.equipment.map((item) => ({
      rect: item.rect,
      candidates: item.candidates,
      selectedId: item.candidates[0]?.id,
      score: item.candidates[0]?.score ?? 0,
      recognition: item.recognition,
    }))
    const equipmentIds = equipment.map((item) => item.selectedId)
    const pet = {
      rect: column.pet.rect,
      candidates: column.pet.candidates,
      selectedId: column.pet.recognizedId,
      score: column.pet.candidates[0]?.score ?? 0,
    }
    const modeCandidate = column.mode?.candidates[0]
    const inference = inferHeroFromEquipment(equipmentIds.filter((id): id is number => id !== undefined))
    const heroId = inference.status === 'confirmed' ? inference.heroId : undefined
    const equipmentScores = equipment.map((item) => item.score)
    const petScore = pet.score
    const wardenModeDefined = heroId === WARDEN_ID ? modeCandidate !== undefined : true
    const unresolved = heroUnresolvedFromEvidence(heroId, equipmentIds, pet.selectedId, petScore, wardenModeDefined)
    const petIsAmbiguous = pet.selectedId !== undefined
      && (column.pet.resolution === 'ambiguous' || petScore < .68)
    const resolvedIssue = petIsAmbiguous && unresolved.issueKind === 'unconfirmed'
      ? { issueKind: 'low-confidence-pet' as const, issue: '战宠候选分数偏低，请核对并选择战宠。' }
      : unresolved
    const confidence = Math.min(...equipmentScores, petScore, ...(heroId === WARDEN_ID ? [modeCandidate?.score ?? 0] : []))
    return {
      key: `hero-${column.index}`,
      rect: unionRects([...column.equipment.map((item) => item.rect), column.pet.rect]),
      loadout: {
        ...(heroId === undefined ? {} : { heroId }),
        ...(pet.selectedId === undefined ? {} : { petId: pet.selectedId }),
        equipmentIds,
        ...(heroId === WARDEN_ID && modeCandidate ? { mode: modeCandidate.value } : {}),
      },
      equipmentScores,
      petScore,
      equipment,
      pet,
      geometryScore: column.geometryScore,
      diagnostics: column.diagnostics,
      mode: heroId === WARDEN_ID
        ? { value: modeCandidate?.value, score: modeCandidate?.score ?? 0, confirmed: false }
        : { score: 1, confirmed: true },
      confidence,
      confirmed: false,
      inference: inference.status === 'confirmed' ? 'equipment-owner' : inference.status,
      issue: resolvedIssue.issue,
      issueKind: resolvedIssue.issueKind,
    }
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
