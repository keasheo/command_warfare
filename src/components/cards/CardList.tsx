import type { Card } from '../../api'

export function CardList({
  cards,
  selectedId,
  onSelect,
}: {
  cards: Card[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="panel">
      <div className="panel-scroll">
        {cards.map((card) => (
          <button
            key={card.id}
            className={`list-item${card.id === selectedId ? ' active' : ''}`}
            onClick={() => onSelect(card.id)}
          >
            <div>{card.name}</div>
            <div className="meta">
              {card.cardType} · {card.rarity} · {card.race} · UV {card.uv ?? '—'}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
