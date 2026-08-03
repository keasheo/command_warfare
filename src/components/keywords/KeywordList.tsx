import type { Keyword } from '../../api'

export function KeywordList({
  keywords,
  selected,
  onSelect,
}: {
  keywords: Keyword[]
  selected: string | null
  onSelect: (name: string) => void
}) {
  return (
    <div className="panel">
      <div className="panel-scroll">
        {keywords.map((keyword) => (
          <button
            key={keyword.name}
            className={`list-item${keyword.name === selected ? ' active' : ''}`}
            onClick={() => onSelect(keyword.name)}
          >
            <div>{keyword.name}</div>
            <div className="meta">
              {(keyword.usageCount ?? 0) === 1
                ? '1 card'
                : `${keyword.usageCount ?? 0} cards`}
              {keyword.tags?.length ? ` · ${keyword.tags.join(', ')}` : ''}
              {!String(keyword.description ?? '').trim() ? ' · needs description' : ''}
            </div>
          </button>
        ))}
        {!keywords.length ? (
          <p className="muted" style={{ padding: '0.75rem' }}>
            No keywords
          </p>
        ) : null}
      </div>
    </div>
  )
}
