import type { GameItem } from '../domain/types'

interface Props {
  item?: GameItem
  className?: string
  decorative?: boolean
}

export function GameIcon({ item, className = '', decorative = false }: Props) {
  if (!item) return <span className={`game-icon game-icon-missing ${className}`} aria-hidden="true">?</span>
  return <img
    className={`game-icon ${className}`}
    src={item.imagePath}
    alt={decorative ? '' : item.displayName}
    title={item.displayName}
    loading="lazy"
    draggable={false}
  />
}
