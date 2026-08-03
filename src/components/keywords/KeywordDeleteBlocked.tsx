import type { KeywordCardRef } from '../../api'

export function KeywordDeleteBlocked({
  message,
  cards,
}: {
  message: string
  cards: KeywordCardRef[]
}) {
  return (
    <div className="keyword-delete-blocked">
      <p className="error" style={{ marginTop: 0 }}>
        {message}
      </p>
      <ul>
        {cards.map((card) => (
          <li key={card.id}>
            {card.name}
            <span className="muted">
              {' '}
              · {[card.cardType, card.race, card.rarity].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
