import { useMemo, useState } from 'react'
import type { CountEntry, GameItem } from '../domain/types'
import { getEntryCount, setEntryCount } from '../domain/composition'
import { GameIcon } from './GameIcon'

interface Props {
  title: string
  description: string
  items: GameItem[]
  entries: CountEntry[]
  onChange: (entries: CountEntry[]) => void
}

export function CountEditor({ title, description, items, entries, onChange }: Props) {
  const [query, setQuery] = useState('')
  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword ? items.filter((item) => `${item.displayName} ${item.name}`.toLowerCase().includes(keyword)) : items
  }, [items, query])

  return <section className="editor-section">
    <div className="editor-title"><div><h3>{title}</h3><p>{description}</p></div>
      {items.length > 12 && <input className="small-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单位" aria-label={`搜索${title}`} />}</div>
    <div className="count-grid">
      {visibleItems.map((item) => {
        const count = getEntryCount(entries, item.id)
        return <article className={`count-card ${count ? 'selected' : ''}`} key={item.id} title={`${item.displayName} · ${item.name}`}>
          <GameIcon item={item} className="count-card-icon" decorative />
          <div className="count-card-copy"><strong>{item.displayName}</strong><span>{item.housingSpace ? `${item.housingSpace} 格` : item.name}</span></div>
          <div className="stepper">
            <button aria-label={`减少${item.displayName}`} onClick={() => onChange(setEntryCount(entries, item.id, count - 1))}>−</button>
            <input aria-label={`${item.displayName}数量`} type="number" min="0" value={count} onChange={(event) => onChange(setEntryCount(entries, item.id, Number(event.target.value)))} />
            <button aria-label={`增加${item.displayName}`} onClick={() => onChange(setEntryCount(entries, item.id, count + 1))}>＋</button>
          </div>
        </article>
      })}
    </div>
  </section>
}
