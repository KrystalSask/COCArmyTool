import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ArmyComposition, ArmyRecord } from './domain/types'
import { isTauri } from './utils/platform'
import { CreatePage } from './pages/CreatePage'
import { EditorPage } from './pages/EditorPage'
import { LibraryPage } from './pages/LibraryPage'
import { createEditorSession, type EditorSession, type EditorSource } from './state/editorSession'
import { listArmyRecords } from './storage/armyDatabase'

const ScreenshotRecognitionPage = lazy(() => import('./pages/ScreenshotRecognitionPage').then((module) => ({ default: module.ScreenshotRecognitionPage })))

type Page = 'create' | 'screenshot' | 'editor' | 'library'

export default function App() {
  const [page, setPage] = useState<Page>('create')
  const [records, setRecords] = useState<ArmyRecord[]>([])
  const [editorSession, setEditorSession] = useState<EditorSession>()
  const [storageError, setStorageError] = useState('')

  const refreshRecords = useCallback(() => {
    listArmyRecords().then(setRecords).catch(() => setStorageError('无法访问浏览器本地数据库，请检查隐私模式或存储权限。'))
  }, [])

  useEffect(refreshRecords, [refreshRecords])

  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!editorSession?.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeClose)
    return () => window.removeEventListener('beforeunload', warnBeforeClose)
  }, [editorSession?.dirty])

  const canLeaveEditor = () => !editorSession?.dirty || window.confirm('当前方案有未保存修改，确定放弃并离开吗？')

  const openEditor = (source: EditorSource, composition?: ArmyComposition, originalLink?: string, record?: ArmyRecord) => {
    if (!canLeaveEditor()) return
    setEditorSession(createEditorSession({ source, composition, originalLink, record }))
    setPage('editor')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigate = (next: Page) => {
    if (next !== 'editor' && page === 'editor') {
      if (!canLeaveEditor()) return
      setEditorSession(undefined)
    }
    if (next === 'editor' && !editorSession) setEditorSession(createEditorSession({ source: 'manual' }))
    setPage(next)
  }

  return <div className="app-shell">
    <header className="app-header">
      <button className="brand" onClick={() => navigate('create')} aria-label="返回新建方案">
        <img src="/game-icons/troop/0.png" alt="" /><span><strong>COCArmyTool</strong><small>国服 · 18级大本营配兵助手</small></span>
      </button>
      <nav aria-label="主要导航">
        <button className={page === 'create' || page === 'screenshot' ? 'active' : ''} onClick={() => navigate('create')}>新建方案</button>
        <button className={page === 'editor' ? 'active' : ''} onClick={() => navigate('editor')}>配兵编辑器{editorSession?.dirty ? ' ·' : ''}</button>
        <button className={page === 'library' ? 'active' : ''} onClick={() => navigate('library')}>方案库 <span>{records.length}</span></button>
      </nav>
    </header>
    {storageError && <p className="status-message error global-message">{storageError}</p>}
    {page === 'create' && <CreatePage onCreateFromLink={(composition, link) => openEditor('link', composition, link)} onCreateManual={() => openEditor('manual')} onOpenScreenshot={() => navigate('screenshot')} />}
    {page === 'screenshot' && <Suspense fallback={<main className="page-stack"><p className="status-message success">正在加载本地视觉识别模块……</p></main>}><ScreenshotRecognitionPage onEditInCalculator={(composition) => openEditor('screenshot', composition)} /></Suspense>}
    {page === 'editor' && editorSession && <EditorPage session={editorSession} onChange={setEditorSession} onSaved={refreshRecords} />}
    {page === 'library' && <LibraryPage records={records} onChanged={refreshRecords} onEditRecord={(record) => openEditor('library', undefined, undefined, record)} onEditComposition={(composition) => openEditor('library', composition)} />}
    <footer><span>COCArmyTool v0.3.0 · {isTauri() ? '数据仅存本机' : '确认后的识别样本会上传用于改进模型'}</span><span>本内容为非官方内容，未经 Supercell 认可。详见 <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noreferrer">Supercell 粉丝内容政策</a>。</span></footer>
  </div>
}
