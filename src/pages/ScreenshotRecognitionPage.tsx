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
import { buildRecognitionReview, confirmAllMockCandidates } from '../recognition/review'
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
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [debug, setDebug] = useState(true)
  const [activeKey, setActiveKey] = useState<string>()
  const [dropActive, setDropActive] = useState(false)
  const [editingPanel, setEditingPanel] = useState(false)
  const [manualPanel, setManualPanel] = useState<NormalizedRect>()

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const acceptFile = useCallback(async (nextFile: File, panelOverride?: NormalizedRect) => {
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
    try {
      const inspected = await inspectScreenshotFile(nextFile, panelOverride)
      setPreflight(inspected)
      setManualPanel(inspected.panel)
      setEditingPanel(false)
      if (inspected.complete) {
        const analysis = await analyzeCardLayout(nextFile, inspected)
        setDetectedRegions(analysis.regions)
        setDetectedHeroes(analysis.heroes)
        setMessage(`完整截图检查通过，识别为“${getLayoutDefinition(inspected.layout)?.label ?? '未知布局'}”。`)
      }
      else setError(inspected.issues.join('；'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChecking(false)
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

  const review = useMemo(() => result ? buildRecognitionReview(result) : undefined, [result])
  const reviewReady = Boolean(preflight?.complete && review && review.unresolvedKeys.length === 0)

  const locate = (key: string) => {
    setActiveKey(key)
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
      {checking && <p className="status-message success">正在本地检查图片……</p>}
      {message && <p className="status-message success">{message}</p>}
      {error && <p className="status-message error">{error}</p>}
      {preflight && <div className="preflight-grid">
        <span><small>尺寸</small><strong>{preflight.width} × {preflight.height}</strong></span>
        <span><small>画面比例</small><strong>{preflight.aspectRatio.toFixed(3)}</strong></span>
        <span><small>页面布局</small><strong>{getLayoutDefinition(preflight.layout)?.label ?? '未识别'}</strong></span>
        <span><small>布局置信度</small><strong>{Math.round(preflight.layoutConfidence * 100)}%</strong></span>
        <span><small>设备画像</small><strong>{preflight.deviceProfile}</strong></span>
        <span data-testid="panel-location" data-panel={`${preflight.panel.x},${preflight.panel.y},${preflight.panel.width},${preflight.panel.height}`}><small>面板定位</small><strong>{Math.round(preflight.panelConfidence * 100)}%</strong></span>
        <span><small>本地摘要</small><strong>{preflight.sha256.slice(0, 12)}</strong></span>
      </div>}
      {detectedRegions.length > 0 && <div className="preflight-grid card-detection-summary">
        {detectedRegions.map((region) => <span
          data-testid={`card-count-${region.region}`}
          data-counts={region.slots.map((slot) => slot.count?.value).filter((value) => value !== undefined).sort((a, b) => a - b).join(',')}
            data-count-confidences={region.slots.map((slot) => slot.count?.confidence.toFixed(3)).join(',')}
            data-count-details={region.slots.map((slot) => `${slot.count?.value ?? '?'}:${slot.count?.confidence.toFixed(3) ?? '0'}`).join(',')}
            data-count-digit-candidates={region.slots.map((slot) => slot.count?.digits.map((digit) => digit.map((candidate) => `${candidate.digit}:${candidate.score.toFixed(3)}`).join('|')).join('_') ?? '').join(';')}
            data-count-glyphs={region.slots.map((slot) => slot.count?.glyphs?.map((glyph) => `${glyph.x}:${glyph.width}`).join('_') ?? '').join(';')}
          data-top1={region.slots.map((slot) => slot.candidates?.[0] ? `${slot.candidates[0].kind}:${slot.candidates[0].id}` : '?').sort().join(',')}
          data-top3={region.slots.map((slot) => slot.candidates?.map((candidate) => `${candidate.kind}:${candidate.id}`).join('|') ?? '').join(';')}
          key={region.region}
        ><small>{region.label}</small><strong>{region.slots.length} 张卡片 · {region.slots.filter((slot) => slot.candidates?.length).length} 张有候选 · {region.slots.filter((slot) => slot.count?.value).length} 个数量</strong></span>)}
      </div>}
        {detectedHeroes.length > 0 && <div className="preflight-grid" data-testid="hero-visual-analysis" data-hero-ids={detectedHeroes.map((hero) => hero.heroId ?? '?').join(',')} data-modes={detectedHeroes.map((hero) => hero.mode?.candidates[0]?.value ?? '').join(',')} data-equipment-ids={detectedHeroes.map((hero) => hero.equipment.map((item) => item.candidates[0]?.id ?? '?').join('_')).join(';')} data-equipment-candidates={detectedHeroes.map((hero) => hero.equipment.map((item) => item.candidates.map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`).join('|')).join('_')).join(';')} data-pet-ids={detectedHeroes.map((hero) => hero.pet.candidates[0]?.id ?? '?').join(',')} data-pet-details={detectedHeroes.map((hero) => `${hero.pet.candidates[0]?.id ?? '?'}:${hero.pet.candidates[0]?.score.toFixed(3) ?? '0'}`).join(',')}>
        {detectedHeroes.map((hero) => <span key={hero.index}><small>英雄列 {hero.index + 1}</small><strong>{hero.heroId === undefined ? '装备归属待确认' : `装备归属 ID ${hero.heroId}`} · 战宠候选 {hero.pet.candidates[0]?.id ?? '—'}</strong></span>)}
      </div>}
    </section>

    {previewUrl && <section className="form-card screenshot-preview-card" ref={previewRef}>
      <div className="section-title"><div><span className="eyebrow">有效区域提取</span><h2>原图与布局调试框</h2></div>
        <label className="debug-toggle"><input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />显示区域调试框</label></div>
      <RecognitionOverlay imageUrl={previewUrl} alt="待识别的完整军队配置截图" result={result} preflightPanel={preflight?.panel} detectedRegions={detectedRegions} debug={debug} activeKey={activeKey} onSelectKey={setActiveKey} editablePanel={editingPanel ? manualPanel : undefined} onEditablePanelChange={setManualPanel} />
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
          <button className="primary-button" disabled={!reviewReady} onClick={() => onEditInCalculator(review.composition)}>确认并进入配兵编辑器</button>
        </div>
      </section>
      <CompositionPanel composition={review.composition} title="截图识别配置预览" />
    </>}
  </main>
}
