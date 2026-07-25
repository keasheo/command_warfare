import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, formatRange, type Card, type Settings } from '../api'

const emptyCard = (): Card => ({
  id: crypto.randomUUID().replaceAll('-', ''),
  name: 'New Card',
  cardType: 'Unit',
  rarity: 'Common',
  unique: false,
  race: null,
  primaryType: null,
  secondaryType: null,
  uv: null,
  move: null,
  damage: null,
  range: null,
  toughness: null,
  companyAp: null,
  companyCapacity: null,
  commandRadius: null,
  apGeneration: null,
  ccGeneration: null,
  abilities: [],
  ultimate: null,
  flavorText: null,
  complexity: null,
  role: null,
  tags: [],
})

function numOrNull(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  if (text.toLowerCase() === 'melee') return 1
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export function CardsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Card | null>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [race, setRace] = useState('')
  const [rarity, setRarity] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const selected = useMemo(
    () => cards.find((c) => c.id === selectedId) ?? null,
    [cards, selectedId],
  )

  async function loadCards(nextQ = q) {
    const result = await api.cards({
      q: nextQ,
      type,
      race,
      rarity,
    })
    setCards(result.cards)
    if (!selectedId && result.cards[0]) {
      setSelectedId(result.cards[0].id)
      setDraft(result.cards[0])
    } else if (selectedId) {
      const still = result.cards.find((c) => c.id === selectedId)
      if (still) setDraft(still)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await api.settings())
        await loadCards('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadCards(q).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
    }, 150)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, race, rarity])

  useEffect(() => {
    if (selected) setDraft({ ...selected, abilities: [...selected.abilities], tags: [...selected.tags] })
  }, [selected])

  function patch<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save() {
    if (!draft) return
    try {
      const { card } = await api.saveCard(draft)
      setStatus(`Saved ${card.name}`)
      setError('')
      await loadCards(q)
      setSelectedId(card.id)
      setDraft(card)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function create() {
    try {
      const { card } = await api.createCard(emptyCard())
      setStatus(`Created ${card.name}`)
      await loadCards(q)
      setSelectedId(card.id)
      setDraft(card)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove() {
    if (!draft) return
    if (!window.confirm(`Delete ${draft.name}?`)) return
    try {
      await api.deleteCard(draft.id)
      setSelectedId(null)
      setDraft(null)
      setStatus(`Deleted ${draft.name}`)
      await loadCards(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Cards</h2>
          <p>Search any field · edit stats · live face preview</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" onClick={() => void create()}>
            New
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!draft}>
            Save
          </button>
          <button className="btn danger" onClick={() => void remove()} disabled={!draft}>
            Delete
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search any card value…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {(settings?.cardTypes ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select value={race} onChange={(e) => setRace(e.target.value)}>
          <option value="">All races</option>
          {(settings?.races ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="">All rarities</option>
          {(settings?.rarities ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">
        {cards.length} shown{status ? ` · ${status}` : ''}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="layout-split">
        <div className="panel">
          <div className="panel-scroll">
            {cards.map((card) => (
              <button
                key={card.id}
                className={`list-item${card.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(card.id)}
              >
                <div>{card.name}</div>
                <div className="meta">
                  {card.cardType} · {card.rarity} · {card.race} · UV {card.uv ?? '—'}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          {draft ? (
            <div className="panel-scroll">
              <CardFace card={draft} />
              <div className="form-grid">
                <Field label="Name" className="span-2">
                  <input value={draft.name} onChange={(e) => patch('name', e.target.value)} />
                </Field>
                <Field label="Card Type">
                  <select
                    value={draft.cardType}
                    onChange={(e) => patch('cardType', e.target.value)}
                  >
                    {(settings?.cardTypes ?? []).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Rarity">
                  <select
                    value={draft.rarity ?? ''}
                    onChange={(e) => patch('rarity', e.target.value || null)}
                  >
                    <option value="">—</option>
                    {(settings?.rarities ?? []).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Unique">
                  <select
                    value={draft.unique ? 'true' : 'false'}
                    onChange={(e) => patch('unique', e.target.value === 'true')}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </Field>
                <Field label="Race">
                  <select
                    value={draft.race ?? ''}
                    onChange={(e) => patch('race', e.target.value || null)}
                  >
                    <option value="">—</option>
                    {(settings?.races ?? []).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Primary Type">
                  <select
                    value={draft.primaryType ?? ''}
                    onChange={(e) => patch('primaryType', e.target.value || null)}
                  >
                    <option value="">—</option>
                    {(settings?.primaryTypes ?? []).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Secondary Type">
                  <select
                    value={draft.secondaryType ?? ''}
                    onChange={(e) => patch('secondaryType', e.target.value || null)}
                  >
                    <option value="">—</option>
                    {(settings?.secondaryTypes ?? []).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Role">
                  <select
                    value={draft.role ?? ''}
                    onChange={(e) => patch('role', e.target.value || null)}
                  >
                    <option value="">—</option>
                    {(settings?.roles ?? []).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="UV">
                  <input
                    value={draft.uv ?? ''}
                    onChange={(e) => patch('uv', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Move">
                  <input
                    value={draft.move ?? ''}
                    onChange={(e) => patch('move', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Damage">
                  <input
                    value={draft.damage ?? ''}
                    onChange={(e) => patch('damage', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Range (1 = Melee)">
                  <input
                    value={
                      draft.range === 1 ? 'Melee' : draft.range == null ? '' : String(draft.range)
                    }
                    onChange={(e) => patch('range', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Toughness">
                  <input
                    value={draft.toughness ?? ''}
                    onChange={(e) => patch('toughness', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Complexity">
                  <input
                    value={draft.complexity ?? ''}
                    onChange={(e) => patch('complexity', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Company AP">
                  <input
                    value={draft.companyAp ?? ''}
                    onChange={(e) => patch('companyAp', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Company Cap.">
                  <input
                    value={draft.companyCapacity ?? ''}
                    onChange={(e) => patch('companyCapacity', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Cmd Radius">
                  <input
                    value={draft.commandRadius ?? ''}
                    onChange={(e) => patch('commandRadius', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="AP Gen">
                  <input
                    value={draft.apGeneration ?? ''}
                    onChange={(e) => patch('apGeneration', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="CC Gen">
                  <input
                    value={draft.ccGeneration ?? ''}
                    onChange={(e) => patch('ccGeneration', numOrNull(e.target.value))}
                  />
                </Field>
                <Field label="Abilities (comma-separated)" className="span-3">
                  <input
                    value={draft.abilities.join(', ')}
                    onChange={(e) =>
                      patch(
                        'abilities',
                        e.target.value
                          .split(',')
                          .map((part) => part.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Ultimate" className="span-2">
                  <input
                    value={draft.ultimate ?? ''}
                    onChange={(e) => patch('ultimate', e.target.value || null)}
                  />
                </Field>
                <Field label="Tags">
                  <input
                    value={draft.tags.join(', ')}
                    onChange={(e) =>
                      patch(
                        'tags',
                        e.target.value
                          .split(',')
                          .map((part) => part.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Flavor Text" className="span-3">
                  <textarea
                    rows={3}
                    value={draft.flavorText ?? ''}
                    onChange={(e) => patch('flavorText', e.target.value || null)}
                  />
                </Field>
                <Field label="Card ID" className="span-3">
                  <input value={draft.id} readOnly />
                </Field>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ padding: '1rem' }}>
              Select a card
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function CardFace({ card }: { card: Card }) {
  const stats: [string, string][] = [
    ['UV', card.uv == null ? '—' : String(card.uv)],
    ['Move', card.move == null ? '—' : String(card.move)],
    ['Damage', card.damage == null ? '—' : String(card.damage)],
    ['Range', formatRange(card.range)],
    ['Toughness', card.toughness == null ? '—' : String(card.toughness)],
  ]
  if (card.cardType === 'Officer') {
    stats.push(
      ['Company AP', card.companyAp == null ? '—' : String(card.companyAp)],
      ['Company Cap.', card.companyCapacity == null ? '—' : String(card.companyCapacity)],
      ['Cmd Radius', card.commandRadius == null ? '—' : String(card.commandRadius)],
    )
  }
  if (card.cardType === 'Commander') {
    stats.push(
      ['AP Gen', card.apGeneration == null ? '—' : String(card.apGeneration)],
      ['CC Gen', card.ccGeneration == null ? '—' : String(card.ccGeneration)],
      ['Cmd Radius', card.commandRadius == null ? '—' : String(card.commandRadius)],
    )
  }

  return (
    <div className="card-face">
      <div className="banner">
        <div>
          <h3>{card.name}</h3>
          <div className="type-line">
            {[card.race, card.primaryType, card.secondaryType].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="muted">
          {card.cardType}
          {card.unique ? ' · Unique' : ''}
          <div>{card.rarity}</div>
        </div>
      </div>
      <div className="stat-row">
        {stats.slice(0, 8).map(([label, value]) => (
          <div className="stat-pill" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: '0.9rem' }}>
        {card.abilities.length
          ? card.abilities.map((name) => <div key={name}>• {name}</div>)
          : 'No abilities'}
        {card.ultimate ? <div style={{ marginTop: '0.4rem' }}>Ultimate — {card.ultimate}</div> : null}
        {card.flavorText ? (
          <em style={{ display: 'block', marginTop: '0.7rem' }}>{card.flavorText}</em>
        ) : null}
      </div>
    </div>
  )
}
