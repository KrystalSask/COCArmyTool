import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CompositionPanel } from '../components/CompositionPanel'
import { RecognitionOverlay } from '../components/RecognitionOverlay'
import { RecognitionReviewPanel } from '../components/RecognitionReviewPanel'
import type { ArmyComposition } from '../domain/types'
import { getLayoutDefinition } from '../recognition/layouts'
import { mockRecognitionEngine } from '../recognition/mockEngine'
import { analyzeCardLayout, type DetectedRegionCards } from '../recognition/cardAnalysis'
import type { AnalyzedHeroColumn } from '../recognition/heroSubcardAnalysis'
import { createVisualRecognitionResult } from '../recognition/visualEngine'
import { inspectScreenshotFile } from '../recognition/preflight'
import { snapManualPanelEdge, type ManualPanelEdge } from '../recognition/panelLocator'
import { projectRectFromViewport } from '../recognition/viewportLocator'
import { buildRecognitionReview, canConfirmAllCandidates, confirmAllCandidates, confirmAllMockCandidates } from '../recognition/review'
import type { NormalizedRect, ScreenshotPreflight, ScreenshotRecognitionResult } from '../recognition/types'
import { listenForDesktopImageDrop } from '../utils/desktopImageDrop'

interface Props {
  onEditInCalculator: (composition: ArmyComposition) => void
}

export function ScreenshotRecognitionPage({ onEditInCalculator }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [file, setFile] = useState<File>()
  const [previewUrl, setPreviewUrl] = useState('')
  const [preflight, setPreflight] = useState<ScreenshotPreflight>()
  const [result, setResult] = useState<ScreenshotRecognitionResult>()
  const [detectedRegions, setDetectedRegions] = useState<DetectedRegionCards[]>([])
  const [detectedHeroes, setDetectedHeroes] = useState<AnalyzedHeroColumn[]>([])
  const [checking, setChecking] = useState(false)
  const [checkingMessage, setCheckingMessage] = useState('正在本地检查图片……')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [debug, setDebug] = useState(true)
  const [activeKey, setActiveKey] = useState<string>()
  const [dropActive, setDropActive] = useState(false)
  const [editingPanel, setEditingPanel] = useState(false)
  const [manualPanel, setManualPanel] = useState<NormalizedRect>()
  const recognitionRunRef = useRef(0)

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const acceptFile = useCallback(async (nextFile: File, panelOverride?: NormalizedRect) => {
    const runId = ++recognitionRunRef.current
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(nextFile)
    setPreviewUrl(URL.createObjectURL(nextFile))
    setPreflight(undefined)
    setResult(undefined)
    setDetectedRegions([])
    setDetectedHeroes([])
    setError('')
    setMessage('')
    setChecking(true)
    setCheckingMessage('正在本地检查图片……')
    try {
      const inspected = await inspectScreenshotFile(nextFile, panelOverride)
      if (runId !== recognitionRunRef.current) return
      setPreflight(inspected)
      setManualPanel(inspected.panel)
      setEditingPanel(false)
      if (inspected.complete) {
        setCheckingMessage('正在加载本地模型并识别军队卡片数量与类别……')
        const analysis = await analyzeCardLayout(nextFile, inspected)
        if (runId !== recognitionRunRef.current) return
        const analyzedPreflight = analysis.selectedPanel ? {
          ...inspected,
          panel: analysis.selectedPanel,
          panelCandidates: analysis.panelCandidates ?? inspected.panelCandidates,
          panelConfidence: analysis.panelCandidates?.[0]?.totalScore ?? inspected.panelConfidence,
        } : inspected
        setPreflight(analyzedPreflight)
        setManualPanel(analyzedPreflight.panel)
        setDetectedRegions(analysis.regions)
        setDetectedHeroes(analysis.heroes)
        setMessage(`完整截图检查通过，识别为“${getLayoutDefinition(inspected.layout)?.label ?? '未知布局'}”。`)
      }
      else setError(inspected.issues.join('；'))
    } catch (reason) {
      if (runId === recognitionRunRef.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (runId === recognitionRunRef.current) setChecking(false)
    }
  }, [previewUrl])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.files ?? [])].find((candidate) => candidate.type.startsWith('image/'))
      if (image) void acceptFile(image)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [acceptFile])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForDesktopImageDrop(
      (image) => { if (!disposed) void acceptFile(image) },
      (reason) => { if (!disposed) setError(reason) },
    ).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup })
      .catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true; unlisten?.() }
  }, [acceptFile])

  const applyManualPanel = () => {
    if (file && manualPanel) void acceptFile(file, manualPanel)
  }

  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

  // 释放被拖拽的边时，只在其附近小范围内吸附到最近连续的真实边界；
  // 无合格边界则保持用户释放的位置。
  const handleManualEdgeRelease = (corner: 'nw' | 'ne' | 'sw' | 'se', releasedPanel: NormalizedRect) => {
    if (!preflight?.viewportPixels || !preflight.gameViewport) return
    const viewport = preflight.gameViewport
    const inViewport = {
      x: (releasedPanel.x - viewport.x) / viewport.width,
      y: (releasedPanel.y - viewport.y) / viewport.height,
      width: releasedPanel.width / viewport.width,
      height: releasedPanel.height / viewport.height,
    }
    let snapped = inViewport
    const edges: ManualPanelEdge[] = []
    if (corner.includes('w')) edges.push('left')
    if (corner.includes('e')) edges.push('right')
    if (corner.includes('n')) edges.push('top')
    if (corner.includes('s')) edges.push('bottom')
    for (const edge of edges) {
      const next = snapManualPanelEdge(preflight.viewportPixels, snapped, edge)
      if (next) snapped = next
    }
    if (snapped === inViewport) return
    const projected = projectRectFromViewport(snapped, viewport)
    const x = clamp(projected.x, 0, .99)
    const y = clamp(projected.y, 0, .99)
    setManualPanel({ x, y, width: Math.min(projected.width, 1 - x), height: Math.min(projected.height, 1 - y) })
  }

  const review = useMemo(() => result ? buildRecognitionReview(result) : undefined, [result])
  const reviewReady = Boolean(preflight?.complete && review && review.unresolvedKeys.length === 0)
  const bulkConfirmReady = Boolean(result && canConfirmAllCandidates(result))

  const locate = (key: string) => {
    setActiveKey(key)
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 激活并滚动到审查面板中对应的证据元素（卡片、英雄列或装备/战宠证据
  // 块）。只滚动审查元素本身，避免与预览滚动互相覆盖。
  const activateReviewKey = (key: string) => {
    setActiveKey(key)
    requestAnimationFrame(() => {
      document.querySelector(`[data-review-key="${key}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    })
  }

  // 结果存在但仍有未解决项时，确认按钮保持可操作：激活并滚动到第一个
  // 未解决项（截图/审查顺序），而不是进入编辑器。
  const focusFirstUnresolved = (keys: string[]) => {
    const key = keys[0]
    if (key) activateReviewKey(key)
  }

  const runMockRecognition = async () => {
    if (!file || !preflight?.complete) return
    setChecking(true)
    setError('')
    try {
      const recognized = await mockRecognitionEngine.recognize(file, preflight)
      setResult(recognized)
      setMessage('模拟识别已完成。请核对黄色和红色项目；当前结果不代表截图真实内容。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setChecking(false) }
  }

  const runVisualRecognition = () => {
    if (!preflight?.complete || !detectedRegions.length || !detectedHeroes.length) return
    setResult(createVisualRecognitionResult(preflight, { regions: detectedRegions, heroes: detectedHeroes }))
    setMessage('真实视觉候选已生成。请逐项确认后再进行容量校验与链接导出。')
  }

  const confirmAllAndEnter = () => {
    if (!result) return
    if (reviewReady && review) {
      onEditInCalculator(review.composition)
      return
    }
    const confirmed = bulkConfirmReady ? confirmAllCandidates(result) : result
    if (confirmed !== result) setResult(confirmed)
    const remaining = buildRecognitionReview(confirmed).unresolvedKeys
    if (remaining.length) focusFirstUnresolved(remaining)
    else onEditInCalculator(buildRecognitionReview(confirmed).composition)
  }

  return <main className="page-stack screenshot-page">
    <section className="intro-card screenshot-intro">
      <span className="eyebrow">浏览器本地处理 · 真实视觉识别</span><h1>从完整截图识别配兵</h1>
      <p>上传国服完整横屏军队配置截图。图片不会上传服务器；识别结果会提供候选并要求人工确认，通过容量与链接回环检查后才能导出。</p>
      <div className={`screenshot-dropzone ${file ? 'has-file' : ''} ${dropActive ? 'drag-active' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDropActive(true) }}
        onDragLeave={() => setDropActive(false)}
        onDragOver={(event) => { event.preventDefault(); setDropActive(true) }} onDrop={(event) => {
        event.preventDefault()
        setDropActive(false)
        const image = [...event.dataTransfer.files].find((candidate) => candidate.type.startsWith('image/'))
        if (image) void acceptFile(image)
        else setError('没有收到可读取的图片文件。若图片来自微信，请复制图片后在应用内按 Ctrl+V。')
      }}>
        <input ref={inputRef} aria-label="上传完整军队配置截图" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const image = event.target.files?.[0]; if (image) void acceptFile(image) }} />
        <div className="dropzone-icon">▣</div><strong>{file ? file.name : '选择、拖放或粘贴完整截图'}</strong>
        <span>支持 PNG、JPG、WebP；建议保留原始分辨率</span>
        <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>{file ? '更换截图' : '选择截图'}</button>
      </div>
      {checking && <p className="status-message success">{checkingMessage}</p>}
      {message && <p className="status-message success">{message}</p>}
      {error && <p className="status-message error">{error}</p>}
      {preflight && <div className="preflight-grid">
        <span><small>尺寸</small><strong>{preflight.width} × {preflight.height}</strong></span>
        <span><small>画面比例</small><strong>{preflight.aspectRatio.toFixed(3)}</strong></span>
        <span><small>页面布局</small><strong>{getLayoutDefinition(preflight.layout)?.label ?? '未识别'}</strong></span>
        <span><small>布局置信度</small><strong>{Math.round(preflight.layoutConfidence * 100)}%</strong></span>
        <span><small>游戏画面</small><strong>{preflight.gameViewport && (preflight.gameViewport.width < .999 || preflight.gameViewport.height < .999) ? '已裁剪黑边' : '完整画面'}</strong></span>
        <span data-testid="panel-location"
          data-panel={`${preflight.panel.x},${preflight.panel.y},${preflight.panel.width},${preflight.panel.height}`}
          data-panel-candidates={preflight.panelCandidates?.map((candidate) => `${candidate.id}:${candidate.geometryScore.toFixed(4)}:${candidate.cardStructureScore?.toFixed(4) ?? '-'}:${candidate.consistencyScore?.toFixed(4) ?? '-'}:${candidate.totalScore?.toFixed(4) ?? '-'}:${candidate.panel.x.toFixed(5)},${candidate.panel.y.toFixed(5)},${candidate.panel.width.toFixed(5)},${candidate.panel.height.toFixed(5)}`).join(';') ?? ''}
          data-panel-selection-gap={preflight.panelSelectionGap?.toFixed(4) ?? ''}>
          <small>面板定位</small><strong>{Math.round(preflight.panelConfidence * 100)}%</strong>
        </span>
        <span><small>本地摘要</small><strong>{preflight.sha256.slice(0, 12)}</strong></span>
      </div>}
      {detectedRegions.length > 0 && <div className="preflight-grid card-detection-summary">
        {detectedRegions.map((region) => <span
          data-testid={`card-count-${region.region}`}
          data-counts={region.slots.map((slot) => slot.count?.value).filter((value) => value !== undefined).sort((a, b) => a - b).join(',')}
            data-count-confidences={region.slots.map((slot) => slot.count?.confidence.toFixed(3)).join(',')}
            data-count-details={region.slots.map((slot) => `${slot.count?.value ?? '?'}:${slot.count?.confidence.toFixed(3) ?? '0'}`).join(',')}
            data-count-sources={region.slots.map((slot) => slot.count?.source ?? 'none').join(',')}
            data-count-raw-text={region.slots.map((slot) => slot.count?.rawText ?? '').join('|')}
            data-count-preprocessing={region.slots.map((slot) => slot.count?.preprocessingVariant ?? 'none').join(',')}
            data-count-digit-candidates={region.slots.map((slot) => slot.count?.digits.map((digit) => digit.map((candidate) => `${candidate.digit}:${candidate.score.toFixed(3)}`).join('|')).join('_') ?? '').join(';')}
            data-count-glyphs={region.slots.map((slot) => slot.count?.glyphs?.map((glyph) => `${glyph.x}:${glyph.width}`).join('_') ?? '').join(';')}
          data-slot-rects={region.slots.map((slot) => `${slot.rect.x.toFixed(5)},${slot.rect.y.toFixed(5)},${slot.rect.width.toFixed(5)},${slot.rect.height.toFixed(5)}`).join(';')}
          data-geometry={region.slots.map((slot) => `${slot.geometry?.source ?? 'unknown'}:${slot.geometry?.score.toFixed(3) ?? '0'}:${slot.geometry?.inferred ? 'inferred' : 'observed'}`).join(';')}
          data-slot-diagnostics={region.slots.map((slot) => slot.diagnostics?.join('|') ?? '').join(';')}
          data-rule-issues={region.validation.issues.map((issue) => `${issue.code}:${issue.slotIndexes.join('_')}`).join(';')}
          data-top1={region.slots.map((slot) => slot.candidates?.[0] ? `${slot.candidates[0].kind}:${slot.candidates[0].id}` : '?').sort().join(',')}
          data-top1-scores={region.slots.map((slot) => slot.candidates?.[0]?.score.toFixed(4) ?? '0').join(',')}
          data-top3={region.slots.map((slot) => slot.candidates?.map((candidate) => `${candidate.kind}:${candidate.id}`).join('|') ?? '').join(';')}
          data-classification-sources={region.slots.map((slot) => slot.classification?.source ?? 'none').join(',')}
          key={region.region}
        ><small>{region.label}</small><strong>{region.slots.length} 张卡片 · {region.slots.filter((slot) => slot.candidates?.length).length} 张有候选 · {region.slots.filter((slot) => slot.count?.value).length} 个数量</strong></span>)}
      </div>}
        {detectedHeroes.length > 0 && <div className="preflight-grid" data-testid="hero-visual-analysis" data-hero-ids={detectedHeroes.map((hero) => hero.heroId ?? '?').join(',')} data-modes={detectedHeroes.map((hero) => hero.mode?.candidates[0]?.value ?? '').join(',')} data-equipment-ids={detectedHeroes.map((hero) => hero.equipment.map((item) => item.candidates[0]?.id ?? '?').join('_')).join(';')} data-equipment-candidates={detectedHeroes.map((hero) => hero.equipment.map((item) => item.candidates.map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`).join('|')).join('_')).join(';')} data-pet-ids={detectedHeroes.map((hero) => hero.pet.recognizedId ?? '?').join(',')} data-pet-details={detectedHeroes.map((hero) => `${hero.pet.candidates[0]?.id ?? '?'}:${hero.pet.candidates[0]?.score.toFixed(3) ?? '0'}`).join(',')}
          data-pet-candidates={detectedHeroes.map((hero) => hero.pet.candidates.map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`).join('|')).join(';')}
          data-equipment-rects={detectedHeroes.flatMap((hero) => hero.equipment).map((item) => `${item.rect.x.toFixed(5)},${item.rect.y.toFixed(5)},${item.rect.width.toFixed(5)},${item.rect.height.toFixed(5)}`).join(';')}
          data-pet-rects={detectedHeroes.map((hero) => `${hero.pet.rect.x.toFixed(5)},${hero.pet.rect.y.toFixed(5)},${hero.pet.rect.width.toFixed(5)},${hero.pet.rect.height.toFixed(5)}`).join(';')}
          data-hero-geometry={detectedHeroes.map((hero) => `${hero.geometryScore.toFixed(3)}:${hero.diagnostics.join('|')}`).join(';')}>
        {detectedHeroes.map((hero) => <span key={hero.index}><small>英雄列 {hero.index + 1}</small><strong>{hero.heroId === undefined ? '装备归属待确认' : `装备归属 ID ${hero.heroId}`} · 战宠候选 {hero.pet.candidates[0]?.id ?? '—'}</strong></span>)}
      </div>}
    </section>

    {previewUrl && <section className="form-card screenshot-preview-card" ref={previewRef}>
      <div className="section-title"><div><span className="eyebrow">有效区域提取</span><h2>原图与布局调试框</h2></div>
        <label className="debug-toggle"><input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />显示区域调试框</label></div>
      <RecognitionOverlay imageUrl={previewUrl} alt="待识别的完整军队配置截图" result={result} preflightPanel={preflight?.panel} detectedRegions={detectedRegions} detectedHeroes={detectedHeroes} debug={debug} activeKey={activeKey} onSelectKey={activateReviewKey} editablePanel={editingPanel ? manualPanel : undefined} onEditablePanelChange={setManualPanel} onEditablePanelRelease={handleManualEdgeRelease} />
      <div className="button-row screenshot-actions">
        <button className="secondary-button" type="button" onClick={() => { setManualPanel(preflight?.panel); setEditingPanel((value) => !value) }}>{editingPanel ? '取消调整面板' : '手动调整面板'}</button>
        {editingPanel && <button className="primary-button" type="button" onClick={applyManualPanel}>按此面板重新识别</button>}
        <button className="primary-button" disabled={!preflight?.complete || checking || !detectedRegions.length} onClick={runVisualRecognition}>生成真实识别候选</button>
        <button className="secondary-button" disabled={!preflight?.complete || checking} onClick={() => void runMockRecognition()}>运行模拟识别</button>
        {!preflight?.complete && <span>完整性检查通过后才能开始识别。</span>}
      </div>
    </section>}

    {result && review && <>
      {result.warnings.map((warning) => <p className="status-message warning standalone-message" key={warning}>{warning}</p>)}
      <RecognitionReviewPanel result={result} activeKey={activeKey} onActiveKey={locate} onChange={setResult} />
      {result.engine === 'mock' && review.unresolvedKeys.length > 0 && <button className="secondary-button mock-confirm-button" onClick={() => setResult(confirmAllMockCandidates(result))}>确认全部模拟候选（仅用于管线验收）</button>}
      <section className="form-card recognition-export-card" data-testid="recognition-review-gate" data-composition={JSON.stringify(review.composition)}>
        <div className="section-title"><div><span className="eyebrow">候选核对</span><h2>{reviewReady ? '识别候选已确认' : '请确认所有识别候选'}</h2></div>
          <span className={`validation-badge ${reviewReady ? 'valid' : 'warning'}`}>{reviewReady ? '可以进入编辑器' : `${review.unresolvedKeys.length} 个待确认项`}</span></div>
        <div className="recognition-gates">
          <span className={preflight?.complete ? 'passed' : ''}>完整截图</span>
          <span className={!review.unresolvedKeys.length ? 'passed' : ''}>候选已确认</span>
          <span>编辑器校验</span>
          <span>保存或复制</span>
        </div>
        <p>识别页面只负责证据与候选确认。配兵容量、英雄规则、方案资料、保存和链接回环校验将在统一编辑器中完成。</p>
        <div className="button-row">
          <button className="primary-button" disabled={!result || checking} onClick={confirmAllAndEnter}>
            {reviewReady ? '进入配兵编辑器' : bulkConfirmReady ? '一键确认全部并进入配兵编辑器' : `定位首个待确认项（剩余 ${review?.unresolvedKeys.length ?? 0} 项）`}
          </button>
        </div>
      </section>
      <CompositionPanel composition={review.composition} title="截图识别配置预览" />
    </>}
  </main>
}
