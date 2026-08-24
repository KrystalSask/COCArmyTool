import type { PointerEvent as ReactPointerEvent } from 'react'
import { rectStyle } from '../recognition/layouts'
import type { ScreenshotRecognitionResult, NormalizedRect } from '../recognition/types'
import type { DetectedRegionCards } from '../recognition/cardAnalysis'

interface Props {
  imageUrl: string
  alt: string
  result?: ScreenshotRecognitionResult
  preflightPanel?: NormalizedRect
  detectedRegions?: DetectedRegionCards[]
  debug: boolean
  activeKey?: string
  onSelectKey?: (key: string) => void
  editablePanel?: NormalizedRect
  onEditablePanelChange?: (panel: NormalizedRect) => void
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function RecognitionOverlay({ imageUrl, alt, result, preflightPanel, detectedRegions, debug, activeKey, onSelectKey, editablePanel, onEditablePanelChange }: Props) {
  const listenToPointer = (event: ReactPointerEvent, update: (dx: number, dy: number) => void) => {
    event.preventDefault()
    const stage = event.currentTarget.closest('.recognition-image-stage')
    if (!stage) return
    const start = { x: event.clientX, y: event.clientY }
    const move = (next: PointerEvent) => {
      const bounds = stage.getBoundingClientRect()
      update((next.clientX - start.x) / bounds.width, (next.clientY - start.y) / bounds.height)
    }
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  const beginResize = (corner: 'nw' | 'ne' | 'sw' | 'se', event: ReactPointerEvent) => {
    if (!editablePanel || !onEditablePanelChange) return
    event.stopPropagation()
    const start = editablePanel
    listenToPointer(event, (dx, dy) => {
      let left = start.x
      let top = start.y
      let right = start.x + start.width
      let bottom = start.y + start.height
      if (corner.includes('w')) left = clamp(left + dx, 0, right - .2)
      if (corner.includes('e')) right = clamp(right + dx, left + .2, 1)
      if (corner.includes('n')) top = clamp(top + dy, 0, bottom - .2)
      if (corner.includes('s')) bottom = clamp(bottom + dy, top + .2, 1)
      onEditablePanelChange({ x: left, y: top, width: right - left, height: bottom - top })
    })
  }

  const beginMove = (event: ReactPointerEvent) => {
    if (!editablePanel || !onEditablePanelChange) return
    const start = editablePanel
    listenToPointer(event, (dx, dy) => onEditablePanelChange({
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    }))
  }

  return <div className="recognition-image-stage">
    <img src={imageUrl} alt={alt} />
    {!result && preflightPanel && debug && <span className="recognition-panel-box" style={rectStyle(preflightPanel)}>检测到的军队面板</span>}
    {editablePanel && <div className="recognition-crop-box" style={rectStyle(editablePanel)} onPointerDown={beginMove}>
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => <button key={corner} type="button" aria-label={`调整面板${corner}`} className={`crop-handle ${corner}`} onPointerDown={(event) => beginResize(corner, event)} />)}
    </div>}
    {!result && debug && detectedRegions?.flatMap((region) => region.slots.map((slot, index) => <span className="recognition-region-box" style={rectStyle(slot.rect)} key={`${region.region}-${index}`}>{index + 1}</span>))}
    {result && debug && <>
      <span className="recognition-panel-box" style={rectStyle(result.panel)}>有效军队面板</span>
      {result.anchors.map((anchor) => <span className="recognition-anchor-box" style={rectStyle(anchor.rect)} key={anchor.key}>{anchor.label}</span>)}
      {result.regions.map((region) => <span className={`recognition-region-box region-${region.kind}`} style={rectStyle(region.rect)} key={region.kind}>{region.label}</span>)}
    </>}
    {result?.cards.map((card) => <button type="button" aria-label={`定位${card.key}`} className={`recognition-card-box ${activeKey === card.key ? 'active' : ''} ${card.confirmed ? 'confirmed' : 'unresolved'}`} style={rectStyle(card.rect)} key={card.key} onClick={() => onSelectKey?.(card.key)} />)}
    {result?.heroes.map((hero) => <button type="button" aria-label={`定位${hero.key}`} className={`recognition-card-box hero-box ${activeKey === hero.key ? 'active' : ''} ${hero.confirmed ? 'confirmed' : 'unresolved'}`} style={rectStyle(hero.rect)} key={hero.key} onClick={() => onSelectKey?.(hero.key)} />)}
  </div>
}
