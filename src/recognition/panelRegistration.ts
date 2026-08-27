import type { NormalizedRect, PanelAnchorEvidence, PanelCandidateDiagnostic } from './types'

export interface CoarsePanelCandidate {
  id: string
  panel: NormalizedRect
  source: PanelCandidateDiagnostic['source']
  geometryScore: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const boundedRect = (rect: NormalizedRect): NormalizedRect => {
  const x = clamp(rect.x, 0, .995)
  const y = clamp(rect.y, 0, .995)
  return { x, y, width: clamp(rect.width, .01, 1 - x), height: clamp(rect.height, .01, 1 - y) }
}

const luminance = (image: ImageData, x: number, y: number) => {
  const boundedX = clamp(Math.round(x), 0, image.width - 1)
  const boundedY = clamp(Math.round(y), 0, image.height - 1)
  const offset = (boundedY * image.width + boundedX) * 4
  return image.data[offset] * .299 + image.data[offset + 1] * .587 + image.data[offset + 2] * .114
}

const ratioInRect = (image: ImageData, rect: NormalizedRect, predicate: (offset: number) => boolean, stride = 3) => {
  const safe = boundedRect(rect)
  const left = Math.round(safe.x * image.width)
  const top = Math.round(safe.y * image.height)
  const right = Math.max(left + 1, Math.round((safe.x + safe.width) * image.width))
  const bottom = Math.max(top + 1, Math.round((safe.y + safe.height) * image.height))
  let matched = 0
  let total = 0
  for (let y = top; y < bottom; y += stride) for (let x = left; x < right; x += stride) {
    total += 1
    if (predicate((y * image.width + x) * 4)) matched += 1
  }
  return total ? matched / total : 0
}

const horizontalEdge = (image: ImageData, panel: NormalizedRect, relativeY: number, fromX: number, toX: number) => {
  const y = (panel.y + panel.height * relativeY) * image.height
  const left = (panel.x + panel.width * fromX) * image.width
  const right = (panel.x + panel.width * toX) * image.width
  let total = 0
  let count = 0
  for (let x = left; x <= right; x += 3) {
    total += Math.abs(luminance(image, x, y - 2) - luminance(image, x, y + 2))
    count += 1
  }
  return clamp(total / Math.max(1, count) / 52, 0, 1)
}

const verticalEdge = (image: ImageData, panel: NormalizedRect, relativeX: number, fromY: number, toY: number) => {
  const x = (panel.x + panel.width * relativeX) * image.width
  const top = (panel.y + panel.height * fromY) * image.height
  const bottom = (panel.y + panel.height * toY) * image.height
  let total = 0
  let count = 0
  for (let y = top; y <= bottom; y += 3) {
    total += Math.abs(luminance(image, x - 2, y) - luminance(image, x + 2, y))
    count += 1
  }
  return clamp(total / Math.max(1, count) / 48, 0, 1)
}

const panelRect = (panel: NormalizedRect, x: number, y: number, width: number, height: number): NormalizedRect => ({
  x: panel.x + panel.width * x,
  y: panel.y + panel.height * y,
  width: panel.width * width,
  height: panel.height * height,
})

export const scorePanelRegistration = (image: ImageData, panelInput: NormalizedRect) => {
  const panel = boundedRect(panelInput)
  const closeRect = panelRect(panel, .925, 0, .07, .105)
  const woodRect = panelRect(panel, .05, .11, .88, .82)
  const close = clamp(ratioInRect(image, closeRect, (offset) => {
    const red = image.data[offset], green = image.data[offset + 1], blue = image.data[offset + 2]
    return red > 145 && red > green * 1.5 && red > blue * 1.3 && green < 130
  }, 1) * 4.5, 0, 1)
  const wood = clamp(ratioInRect(image, woodRect, (offset) => {
    const red = image.data[offset], green = image.data[offset + 1], blue = image.data[offset + 2]
    return red > 58 && red < 220 && red > green * 1.05 && green > blue * .92 && blue < 155
  }, 4) / .55, 0, 1)

  const dividerValues = [.205, .482, .742].map((y) => horizontalEdge(image, panel, y, .40, .985))
  const divider = dividerValues.reduce((sum, value) => sum + value, 0) / dividerValues.length
  const heroEdges = [.015, .058, .092, .134, .151, .192, .221, .263, .279, .321, .350, .392, .421]
    .map((x) => verticalEdge(image, panel, x, .76, .955))
  heroEdges.sort((left, right) => right - left)
  const heroColumns = heroEdges.slice(0, 8).reduce((sum, value) => sum + value, 0) / 8
  const equipmentRow = Math.max(
    horizontalEdge(image, panel, .858, .01, .425),
    horizontalEdge(image, panel, .947, .01, .425),
  )
  const panelEdge = (
    verticalEdge(image, panel, .002, .10, .88)
    + verticalEdge(image, panel, .998, .10, .88)
    + horizontalEdge(image, panel, .003, .08, .92)
  ) / 3
  const score = close * .20 + wood * .15 + divider * .20 + heroColumns * .20 + equipmentRow * .15 + panelEdge * .10
  const evidence: PanelAnchorEvidence[] = [
    { kind: 'close-button', rect: closeRect, score: close },
    { kind: 'wood', rect: woodRect, score: wood },
    { kind: 'divider', rect: panelRect(panel, .40, .19, .585, .57), score: divider },
    { kind: 'hero-columns', rect: panelRect(panel, .01, .73, .415, .225), score: heroColumns },
    { kind: 'equipment-row', rect: panelRect(panel, .01, .84, .415, .12), score: equipmentRow },
    { kind: 'panel-edge', rect: panel, score: panelEdge },
  ]
  return { score, evidence }
}

const adjust = (panel: NormalizedRect, axis: 'x' | 'y' | 'width' | 'height', fraction: number) => {
  const next = { ...panel }
  if (axis === 'x') next.x += panel.width * fraction
  else if (axis === 'y') next.y += panel.height * fraction
  else if (axis === 'width') next.width *= 1 + fraction
  else next.height *= 1 + fraction
  return boundedRect(next)
}

const refineCandidate = (image: ImageData, candidate: CoarsePanelCandidate): PanelCandidateDiagnostic => {
  let panel = boundedRect(candidate.panel)
  let scored = scorePanelRegistration(image, panel)
  for (const radius of [.012, .006]) {
    for (const axis of ['x', 'y', 'width', 'height'] as const) {
      const options = [-radius, 0, radius].map((delta) => {
        const candidatePanel = adjust(panel, axis, delta)
        return { panel: candidatePanel, scored: scorePanelRegistration(image, candidatePanel) }
      }).sort((left, right) => right.scored.score - left.scored.score)
      panel = options[0].panel
      scored = options[0].scored
    }
  }
  return {
    id: candidate.id,
    panel,
    source: candidate.source,
    geometryScore: scored.score * .86 + candidate.geometryScore * .14,
    anchorEvidence: scored.evidence,
  }
}

const intersectionOverUnion = (left: NormalizedRect, right: NormalizedRect) => {
  const x0 = Math.max(left.x, right.x), y0 = Math.max(left.y, right.y)
  const x1 = Math.min(left.x + left.width, right.x + right.width)
  const y1 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return intersection / Math.max(.000001, left.width * left.height + right.width * right.height - intersection)
}

export const registerPanelCandidates = (image: ImageData, candidates: CoarsePanelCandidate[], limit = 3) => {
  const exact = candidates.map((candidate) => {
    const scored = scorePanelRegistration(image, candidate.panel)
    return {
      id: `${candidate.id}-exact`, panel: boundedRect(candidate.panel), source: candidate.source,
      geometryScore: scored.score * .86 + candidate.geometryScore * .14, anchorEvidence: scored.evidence,
    } satisfies PanelCandidateDiagnostic
  })
  const ranked = [...exact, ...candidates.map((candidate) => refineCandidate(image, candidate))]
    .sort((left, right) => right.geometryScore - left.geometryScore)
  return ranked.filter((candidate, index, all) => all.slice(0, index).every((other) => intersectionOverUnion(candidate.panel, other.panel) < .997)).slice(0, limit)
}
