import type { NormalizedRect } from './types'

export interface PixelBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type CardSlotGeometrySource = 'badge' | 'edge-sequence' | 'frame-components' | 'legacy-detector'

export interface GeometricCardSlot {
  rect: NormalizedRect
  badgeConfidence: number
  geometry?: {
    source: CardSlotGeometrySource
    score: number
    inferred: boolean
  }
  diagnostics?: string[]
}

export interface CardClassCandidate {
  id: number
  kind: 'troop' | 'siege' | 'spell'
  score: number
  rawScore?: number
}

export interface DetectedCardSlot extends GeometricCardSlot {
  /** Compatibility field consumed by the current review UI. */
  candidates?: CardClassCandidate[]
  classification?: {
    candidates: CardClassCandidate[]
    /** Independent legacy evidence kept for narrow, explainable corrections. */
    shadowCandidates?: CardClassCandidate[]
    resolvedBy?: 'shadow-template'
    source: 'onnx' | 'legacy-template'
    modelVersion: string
    preprocessingVersion: string
  }
  validationIssues?: string[]
  suggestions?: Array<{ kind: 'count' | 'category', message: string, value?: number }>
  /** @deprecated Kept only for the explicit legacy-auto-correct rollback path. */
  categoryConstrained?: boolean
  count?: {
    value?: number
    confidence: number
    candidates?: Array<{ value: number, score: number }>
    constrained?: boolean
    digits: Array<Array<{ digit: string, score: number }>>
    glyphs?: Array<{ x: number, width: number }>
    rawText?: string
    badgeRect?: NormalizedRect
    source?: 'ppocrv6' | 'legacy-bitmap' | 'none'
    preprocessingVariant?: 'raw' | 'gray' | 'contrast' | 'none'
  }
}

export interface GlyphComponent {
  x: number
  y: number
  width: number
  height: number
  area: number
}

interface EdgeSequence {
  positions: number[]
  pitch: number
  score: number
}

const isWhiteGlyphPixel = (data: Uint8ClampedArray, offset: number) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  return Math.max(red, green, blue) >= 195 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 95
}

export const findWhiteGlyphComponents = (image: PixelBuffer, rect: { left: number, top: number, width: number, height: number }) => {
  const visited = new Uint8Array(rect.width * rect.height)
  const components: GlyphComponent[] = []
  const queueX = new Int32Array(rect.width * rect.height)
  const queueY = new Int32Array(rect.width * rect.height)

  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const localIndex = localY * rect.width + localX
      if (visited[localIndex]) continue
      visited[localIndex] = 1
      const sourceOffset = ((rect.top + localY) * image.width + rect.left + localX) * 4
      if (!isWhiteGlyphPixel(image.data, sourceOffset)) continue
      let head = 0
      let tail = 1
      queueX[0] = localX
      queueY[0] = localY
      let minX = localX
      let maxX = localX
      let minY = localY
      let maxY = localY
      let area = 0
      while (head < tail) {
        const x = queueX[head]
        const y = queueY[head]
        head += 1
        area += 1
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nextX < 0 || nextY < 0 || nextX >= rect.width || nextY >= rect.height) continue
          const nextIndex = nextY * rect.width + nextX
          if (visited[nextIndex]) continue
          visited[nextIndex] = 1
          const nextOffset = ((rect.top + nextY) * image.width + rect.left + nextX) * 4
          if (!isWhiteGlyphPixel(image.data, nextOffset)) continue
          queueX[tail] = nextX
          queueY[tail] = nextY
          tail += 1
        }
      }
      components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area })
    }
  }
  return components
}

const luma = (data: Uint8ClampedArray, offset: number) => data[offset] * .299 + data[offset + 1] * .587 + data[offset + 2] * .114

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Build a one-dimensional projection of edges that repeat through a card row. */
const verticalEdgeProfile = (image: PixelBuffer, left: number, top: number, width: number, height: number) => {
  const raw = Array.from({ length: width }, () => 0)
  const startY = Math.max(1, Math.round(height * .04))
  const endY = Math.min(height - 1, Math.round(height * .96))
  for (let localX = 2; localX < width - 2; localX += 1) {
    const gradients: number[] = []
    for (let localY = startY; localY < endY; localY += 2) {
      const y = top + localY
      const right = luma(image.data, ((y - 1) * image.width + left + localX + 1) * 4)
        + luma(image.data, (y * image.width + left + localX + 1) * 4) * 2
        + luma(image.data, ((y + 1) * image.width + left + localX + 1) * 4)
      const leftValue = luma(image.data, ((y - 1) * image.width + left + localX - 1) * 4)
        + luma(image.data, (y * image.width + left + localX - 1) * 4) * 2
        + luma(image.data, ((y + 1) * image.width + left + localX - 1) * 4)
      gradients.push(Math.abs(right - leftValue))
    }
    gradients.sort((a, b) => a - b)
    const upperQuartile = gradients[Math.floor(gradients.length * .75)] ?? 0
    const mean = gradients.reduce((sum, value) => sum + value, 0) / Math.max(1, gradients.length)
    raw[localX] = upperQuartile + mean * .5
  }
  return raw.map((_value, x) => {
    let weighted = 0
    let totalWeight = 0
    for (let offset = -2; offset <= 2; offset += 1) {
      const sample = raw[x + offset]
      if (sample === undefined) continue
      const weight = 3 - Math.abs(offset)
      weighted += sample * weight
      totalWeight += weight
    }
    return totalWeight ? weighted / totalWeight : 0
  })
}

const edgePeaks = (profile: number[]) => {
  const center = median(profile)
  const deviation = Math.sqrt(profile.reduce((sum, value) => sum + (value - center) ** 2, 0) / Math.max(1, profile.length)) || 1
  const normalized = profile.map((value) => (value - center) / deviation)
  const peaks: number[] = []
  for (let x = 4; x < normalized.length - 4; x += 1) {
    if (normalized[x] < .35) continue
    let maximum = true
    for (let offset = -3; offset <= 3; offset += 1) if (normalized[x + offset] > normalized[x]) maximum = false
    if (maximum) peaks.push(x)
  }
  return { normalized, peaks }
}

/** Select the strongest near-periodic sequence instead of treating every edge as a card. */
const periodicEdgeSequence = (profile: number[], minimumPitch: number, maximumPitch: number): EdgeSequence | undefined => {
  const { normalized, peaks } = edgePeaks(profile)
  let best: EdgeSequence | undefined
  for (let firstIndex = 0; firstIndex < peaks.length; firstIndex += 1) {
    const first = peaks[firstIndex]
    for (let secondIndex = firstIndex + 1; secondIndex < peaks.length; secondIndex += 1) {
      const second = peaks[secondIndex]
      const initialPitch = second - first
      if (initialPitch < minimumPitch) continue
      if (initialPitch > maximumPitch) break
      if (normalized[first] < .8 || normalized[second] < .8) continue
      if (first > initialPitch * 1.05) continue
      const positions = [first, second]
      const gaps = [initialPitch]
      let current = second
      while (positions.length < 12) {
        const pitch = median(gaps.slice(-3))
        const expected = current + pitch
        const tolerance = Math.max(10, pitch * .14)
        const alternatives = peaks.filter((candidate) => candidate > current && Math.abs(candidate - expected) <= tolerance)
        if (!alternatives.length) break
        const selected = alternatives.sort((left, right) =>
          (normalized[right] - Math.abs(right - expected) / tolerance * .4)
          - (normalized[left] - Math.abs(left - expected) / tolerance * .4))[0]
        gaps.push(selected - current)
        positions.push(selected)
        current = selected
      }
      const pitch = median(positions.slice(1).map((value, index) => value - positions[index]))
      while (positions.length > 1 && positions[positions.length - 1] > profile.length - pitch * .48) positions.pop()
      if (positions.length < 2) continue
      const spacing = positions.slice(1).map((value, index) => value - positions[index])
      const spacingDeviation = Math.sqrt(spacing.reduce((sum, value) => sum + (value - pitch) ** 2, 0) / Math.max(1, spacing.length)) / pitch
      const evidence = positions.reduce((sum, position) => sum + Math.max(-.5, Math.min(2, normalized[position])), 0)
      const score = positions.length * 2 + evidence - spacingDeviation * 10 - first / pitch
      if (!best || score > best.score) best = { positions: [...positions], pitch, score }
    }
  }
  return best
}

const slotsFromEdgePositions = (positions: number[], pitch: number, image: PixelBuffer, left: number, top: number, width: number, fullHeight: number, scale: number) => positions.map((position, index) => {
  const cardLeft = Math.max(0, position - 10 * scale)
  const nextLeft = index + 1 < positions.length ? Math.max(cardLeft + 1, positions[index + 1] - 10 * scale) : Math.min(width, cardLeft + pitch)
  return {
    rect: { x: (left + cardLeft) / image.width, y: top / image.height, width: (nextLeft - cardLeft) / image.width, height: fullHeight / image.height },
    badgeConfidence: .62,
    geometry: { source: 'edge-sequence' as const, score: .62, inferred: true },
  }
})

/** Restore missing card starts when a gap is an integer multiple of the row pitch. */
const fillPeriodicGaps = (positions: number[], pitch: number) => {
  if (positions.length < 2 || pitch <= 0) return positions
  const completed: number[] = [positions[0]]
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1]
    const current = positions[index]
    const gap = current - previous
    const steps = Math.round(gap / pitch)
    if (steps >= 2 && steps <= 4 && Math.abs(gap / pitch - steps) <= .28) {
      for (let step = 1; step < steps; step += 1) completed.push(previous + gap * step / steps)
    }
    completed.push(current)
  }
  return completed
}

const detectEdgeSlots = (image: PixelBuffer, left: number, top: number, width: number, fullHeight: number, scale: number, badgeAnchor?: number) => {
  const profile = verticalEdgeProfile(image, left, top, width, fullHeight)
  const minimumPitch = Math.max(95, 75 * scale)
  const maximumPitch = Math.max(120, 190 * scale)
  const sequence = periodicEdgeSequence(profile, minimumPitch, maximumPitch)
  // A single false x-like edge is common in compressed spell rows. A long,
  // coherent visual sequence is stronger evidence than that lone glyph.
  if (sequence && sequence.positions.length >= 4) {
    const maximumCards = width / image.width < .22 ? 3 : 12
    const positions = fillPeriodicGaps(sequence.positions, sequence.pitch).slice(0, maximumCards)
    return slotsFromEdgePositions(positions, sequence.pitch, image, left, top, width, fullHeight, scale)
  }
  if (badgeAnchor !== undefined) {
    const { normalized, peaks } = edgePeaks(profile)
    const anchor = [...peaks].sort((a, b) => Math.abs(a - badgeAnchor) - Math.abs(b - badgeAnchor))[0]
    if (anchor !== undefined && Math.abs(anchor - badgeAnchor) <= 28 * scale) {
      const forward = peaks.filter((position) => position - anchor >= minimumPitch && position - anchor <= maximumPitch
        && position < width - 20 * scale && normalized[position] >= .9)
        .sort((a, b) => normalized[b] - normalized[a])[0]
      const backward = peaks.filter((position) => anchor - position >= minimumPitch && anchor - position <= maximumPitch
        && normalized[position] >= .9).sort((a, b) => normalized[b] - normalized[a])[0]
      const positions = [backward, anchor, forward].filter((position): position is number => position !== undefined).sort((a, b) => a - b)
      if (positions.length >= 2) {
        const pitch = median(positions.slice(1).map((position, index) => position - positions[index]))
        return slotsFromEdgePositions(fillPeriodicGaps(positions, pitch), pitch, image, left, top, width, fullHeight, scale)
      }
    }
  }
  if (!sequence) return []
  const maximumCards = width / image.width < .22 ? 3 : 12
  const positions = fillPeriodicGaps(sequence.positions, sequence.pitch).slice(0, maximumCards)
  return slotsFromEdgePositions(positions, sequence.pitch, image, left, top, width, fullHeight, scale)
}

const blueFrameRatio = (image: PixelBuffer, left: number, top: number, width: number, height: number) => {
  let matched = 0
  let total = 0
  const right = Math.min(image.width, left + width)
  const bottom = Math.min(image.height, top + height)
  for (let y = Math.max(0, top); y < bottom; y += 2) for (let x = Math.max(0, left); x < right; x += 2) {
    const offset = (y * image.width + x) * 4
    const red = image.data[offset]
    const green = image.data[offset + 1]
    const blue = image.data[offset + 2]
    total += 1
    if (blue > 105 && (blue > red * 1.08 || blue > green * 1.20)) matched += 1
  }
  return total ? matched / total : 0
}

export const detectCardSlots = (image: PixelBuffer, region: NormalizedRect, options: { allowLeadingRecovery?: boolean, trimTrailingFrameless?: boolean } = {}): DetectedCardSlot[] => {
  const left = Math.max(0, Math.round(region.x * image.width))
  const top = Math.max(0, Math.round(region.y * image.height))
  const width = Math.min(image.width - left, Math.round(region.width * image.width))
  const fullHeight = Math.min(image.height - top, Math.round(region.height * image.height))
  if (width <= 0 || fullHeight <= 0) return []
  const height = Math.max(1, Math.round(fullHeight * .30))
  const scale = Math.max(.35, width / (region.width * 2160))
  const finishStructuralSlots = (slots: DetectedCardSlot[]) => {
    const scored = slots.map((slot) => {
      const slotLeft = Math.max(0, Math.round(slot.rect.x * image.width))
      const slotTop = Math.max(0, Math.round(slot.rect.y * image.height))
      const slotWidth = Math.max(1, Math.round(slot.rect.width * image.width))
      const slotHeight = Math.max(1, Math.round(slot.rect.height * image.height))
      const frameRatio = blueFrameRatio(image, slotLeft, slotTop, slotWidth, slotHeight)
      return { slot: { ...slot, diagnostics: [...(slot.diagnostics ?? []), `blue-frame:${frameRatio.toFixed(3)}`] }, frameRatio }
    })
    while (options.trimTrailingFrameless && scored.length > 1 && scored[scored.length - 1].frameRatio < .04) scored.pop()
    return scored.map(({ slot }) => slot)
  }
  const frameComponentSlots = () => {
    const columnHits = new Int32Array(width)
    for (let localX = 0; localX < width; localX += 1) for (let localY = 0; localY < fullHeight; localY += 2) {
      const offset = ((top + localY) * image.width + left + localX) * 4
      const red = image.data[offset]
      const green = image.data[offset + 1]
      const blue = image.data[offset + 2]
      if (blue > 105 && (blue > red * 1.08 || blue > green * 1.20)) columnHits[localX] += 1
    }
    const groups: Array<{ left: number, right: number }> = []
    let groupStart = -1
    const threshold = fullHeight * .08
    for (let x = 0; x <= width; x += 1) {
      const active = x < width && columnHits[x] >= threshold
      if (active && groupStart < 0) groupStart = x
      if (!active && groupStart >= 0) {
        if (x - groupStart >= 35 * scale) groups.push({ left: groupStart, right: x })
        groupStart = -1
      }
    }
    return groups.filter((group) => group.right - group.left <= 220 * scale).map((group) => ({
      rect: { x: (left + Math.max(0, group.left - 5 * scale)) / image.width, y: top / image.height, width: Math.min(width - group.left, group.right - group.left + 10 * scale) / image.width, height: fullHeight / image.height },
      badgeConfidence: .45,
      geometry: { source: 'frame-components' as const, score: .45, inferred: true },
    }))
  }
  const whiteComponents = findWhiteGlyphComponents(image, { left, top, width, height })
  const glyphs = whiteComponents.filter((component) =>
    component.width >= 4 * scale && component.width <= 25 * scale
    && component.height >= 11 * scale && component.height <= 29 * scale
    && component.area >= 35 * scale * scale)
  const xGlyphs = glyphs.filter((component) => {
    const looksLikeX = component.width >= 13 * scale && component.width <= 22 * scale
      && component.height >= 13 * scale && component.height <= 25 * scale
      && component.area >= 125 * scale * scale
    if (!looksLikeX) return false
    return glyphs.some((next) => next.x > component.x + 12 * scale
      && next.x < component.x + 45 * scale
      && Math.abs(next.y - component.y) < 10 * scale)
  }).sort((a, b) => a.x - b.x)

  const badges: GlyphComponent[] = []
  for (const glyph of xGlyphs) {
    if (!badges.length || glyph.x - badges[badges.length - 1].x >= 55 * scale) badges.push(glyph)
  }
  const edgeDetectedSlots = detectEdgeSlots(image, left, top, width, fullHeight, scale, badges.length === 1 ? badges[0].x : undefined)
  const quantityEvidenceFor = (slot: DetectedCardSlot) => {
    const slotLeft = slot.rect.x * image.width - left
    const slotRight = (slot.rect.x + slot.rect.width) * image.width - left
    return whiteComponents.some((component) => component.x >= slotLeft - 4 * scale
      && component.x < slotRight + 4 * scale
      && component.y < height * .92
      && component.width >= 3 * scale
      && component.height >= 8 * scale
      && component.area >= 50 * scale * scale)
  }
  if (badges.length === 1 && edgeDetectedSlots.length > 1) {
    // A single readable xN can anchor a sequence, but artwork seams may add
    // empty trailing slots. Keep a trailing card only when its own quantity
    // glyph is present; this trims false extensions without inventing a count.
    const evidence = edgeDetectedSlots.map(quantityEvidenceFor)
    const lastEvidence = evidence.reduce((last, present, index) => present ? index : last, -1)
    if (lastEvidence >= 0 && lastEvidence < edgeDetectedSlots.length - 1) return finishStructuralSlots(edgeDetectedSlots.slice(0, lastEvidence + 1))
  }
  // With zero or one readable quantity badge, spacing cannot be estimated from
  // text. Use the repeated vertical card structure as the primary detector.
  if (badges.length <= 1 && edgeDetectedSlots.length > badges.length) return finishStructuralSlots(edgeDetectedSlots)
  if (!badges.length) {
    // Compressed video frames may break the small white `xN` glyph into pieces.
    // Fall back to contiguous cyan/purple card-frame columns inside the known row.
    return finishStructuralSlots(frameComponentSlots())
  }
  const gaps = badges.slice(1).map((badge, index) => badge.x - badges[index].x)
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const typicalWidth = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : Math.min(170 * scale, width)
  // Compression can split one xN badge into two x-like components. Once the
  // row pitch is known, discard the second component of an impossibly close
  // pair instead of turning one visual card into two narrow slots.
  const stableBadges = badges.reduce<GlyphComponent[]>((result, badge) => {
    if (!result.length || badge.x - result[result.length - 1].x >= typicalWidth * .55) result.push(badge)
    return result
  }, [])
  const completedBadges: Array<GlyphComponent & { inferred?: boolean }> = [...stableBadges]
  const hasLeadingEdge = edgeDetectedSlots.some((slot) => slot.rect.x * image.width - left + 10 * scale < typicalWidth * .45)
  const leadingFrameThreshold = width / image.width < .4 ? .06 : .10
  const hasLeadingFrame = stableBadges[0].x > typicalWidth * .70 && blueFrameRatio(
    image,
    left + Math.max(0, stableBadges[0].x - typicalWidth - 10 * scale),
    top,
    Math.min(typicalWidth, stableBadges[0].x),
    fullHeight,
  ) >= leadingFrameThreshold
  const expectedLeadingBadge = stableBadges[0].x - typicalWidth
  const hasLeadingGlyphFragment = whiteComponents.some((glyph) => glyph.x >= expectedLeadingBadge - 20 * scale
    && glyph.x <= expectedLeadingBadge + 50 * scale && glyph.width >= 3 * scale && glyph.width <= 35 * scale
    && glyph.height >= 8 * scale && glyph.height <= 32 * scale && glyph.area >= 50 * scale * scale)
  const completedLeadingCard = options.allowLeadingRecovery !== false && stableBadges.length >= 2 && stableBadges[0].x > typicalWidth * .70
    && (hasLeadingEdge || (hasLeadingFrame && hasLeadingGlyphFragment))
  if (completedLeadingCard) completedBadges.unshift({
    x: Math.max(10 * scale, stableBadges[0].x - typicalWidth), y: stableBadges[0].y,
    width: 18 * scale, height: 18 * scale, area: 125 * scale * scale,
  })
  if (stableBadges.length >= 2 && !completedLeadingCard) {
    const nextExpected = stableBadges[stableBadges.length - 1].x + typicalWidth
    const hasRoom = nextExpected + typicalWidth * (width / image.width > .5 ? .9 : .45) < width
    const hasEdgeEvidence = edgeDetectedSlots.some((slot) => {
      const edgeX = slot.rect.x * image.width - left + 10 * scale
      return Math.abs(edgeX - nextExpected) <= typicalWidth * .42
    })
    const frameThreshold = width / image.width < .4 ? .06 : .10
    const hasCardFrame = blueFrameRatio(image, left + Math.max(0, nextExpected - 10 * scale), top,
      Math.min(typicalWidth, width - nextExpected), fullHeight) >= frameThreshold
    // A compressed xN can be broken into pieces. Requiring both a periodic edge
    // and a remaining white fragment avoids extending into the empty row tail.
    const hasGlyphFragment = whiteComponents.some((glyph) => glyph.x >= nextExpected - 20 * scale
      && glyph.x <= nextExpected + 50 * scale && glyph.width >= 3 * scale && glyph.width <= 35 * scale
      && glyph.height >= 8 * scale && glyph.height <= 32 * scale && glyph.area >= 50 * scale * scale)
    const narrowFrameContinuation = width / image.width < .4 && hasCardFrame
    const longRowContinuation = stableBadges.length >= 8 && hasEdgeEvidence && hasCardFrame
    if (hasRoom && (hasGlyphFragment || narrowFrameContinuation || longRowContinuation)) completedBadges.push({
      x: nextExpected, y: stableBadges[stableBadges.length - 1].y, width: 18 * scale, height: 18 * scale, area: 125 * scale * scale,
    })
  }
  const spacedBadges: Array<GlyphComponent & { inferred?: boolean }> = []
  completedBadges.forEach((badge, index) => {
    const previous = completedBadges[index - 1]
    if (previous) {
      const gap = badge.x - previous.x
      const steps = Math.round(gap / typicalWidth)
      if (steps >= 2 && steps <= 4 && Math.abs(gap / typicalWidth - steps) <= .28) {
        for (let step = 1; step < steps; step += 1) spacedBadges.push({
          ...previous,
          x: previous.x + gap * step / steps,
          inferred: true,
        })
      }
    }
    spacedBadges.push(badge)
  })
  const badgeSlots = spacedBadges.map((badge, index) => {
    const cardLeft = Math.max(0, badge.x - 10 * scale)
    const nextLeft = index + 1 < spacedBadges.length ? Math.max(cardLeft + 1, spacedBadges[index + 1].x - 10 * scale) : Math.min(width, cardLeft + typicalWidth)
    const frameRatio = blueFrameRatio(image, left + cardLeft, top, nextLeft - cardLeft, fullHeight)
    return {
      rect: {
        x: (left + cardLeft) / image.width,
        y: top / image.height,
        width: (nextLeft - cardLeft) / image.width,
        height: fullHeight / image.height,
      },
      badgeConfidence: badge.inferred ? .62 : .9,
      geometry: { source: 'badge' as const, score: badge.inferred ? .62 : .9, inferred: Boolean(badge.inferred) },
      diagnostics: [
        `badge-component:${badge.width.toFixed(1)}x${badge.height.toFixed(1)}@${badge.x.toFixed(1)}`,
        `blue-frame:${frameRatio.toFixed(3)}`,
      ],
      frameRatio,
    }
  })
  // Action buttons can contain an x-like white component at exactly the card
  // pitch. A real card still has a measurable cyan/purple frame; trim only a
  // trailing geometry candidate with essentially no frame evidence.
  while (options.trimTrailingFrameless && badgeSlots.length > 1 && badgeSlots[badgeSlots.length - 1].frameRatio < .04) badgeSlots.pop()
  return badgeSlots.map(({ frameRatio: _frameRatio, ...slot }) => slot)
}
