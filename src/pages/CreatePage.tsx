import { useState } from 'react'
import { CompositionPanel } from '../components/CompositionPanel'
import { parseArmyLink } from '../domain/armyLink'
import type { ArmyComposition } from '../domain/types'

interface Props {
  onCreateFromLink: (composition: ArmyComposition, originalLink: string) => void
  onCreateManual: () => void
  onOpenScreenshot: () => void
}

export function CreatePage({ onCreateFromLink, onCreateManual, onOpenScreenshot }: Props) {
  const [input, setInput] = useState('')
  const [composition, setComposition] = useState<ArmyComposition | null>(null)
  const [error, setError] = useState('')

  const parse = () => {
    try {
      setComposition(parseArmyLink(input))
      setError('')
    } catch (reason) {
      setComposition(null)
      setError(reason instanceof Error ? reason.message : '无法解析该链接')
    }
  }

  return <main className="page-stack">
    <section className="intro-card create-intro">
      <div><span className="eyebrow">新建方案</span><h1>选择配兵的创建方式</h1><p>通过链接、完整横屏截图或手动配置开始；确认内容后都会进入同一个配兵编辑器。</p></div>
      <div className="creation-methods">
        <article className="creation-method-card"><span>01</span><h2>链接导入</h2><p>粘贴国服 CopyArmy 链接，先解析并核对摘要。</p></article>
        <button className="creation-method-card method-button" onClick={onOpenScreenshot}><span>02</span><h2>截图识别</h2><p>选择完整横屏截图，人工核对识别候选。</p></button>
        <button className="creation-method-card method-button" onClick={onCreateManual}><span>03</span><h2>手动创建</h2><p>从空白方案开始配置军队、法术和英雄。</p></button>
      </div>
      <div className="link-create-panel">
        <label htmlFor="create-link">国服配兵链接</label>
        <textarea id="create-link" value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://link.clashofclans.com/cn?action=CopyArmy&army=..." rows={4} />
        <div className="button-row"><button className="primary-button" onClick={parse}>解析链接</button><button className="ghost-button" onClick={() => { setInput(''); setComposition(null); setError('') }}>清空</button></div>
        {error && <p className="status-message error">{error}</p>}
      </div>
    </section>
    {composition && <>
      <p className="status-message success standalone-message">链接解析成功。确认摘要后进入统一编辑器继续修改、保存或复制。</p>
      <CompositionPanel composition={composition} title="链接解析摘要" />
      <div className="button-row create-continue"><button className="primary-button" onClick={() => onCreateFromLink(composition, input.trim())}>进入配兵编辑器</button></div>
    </>}
  </main>
}
