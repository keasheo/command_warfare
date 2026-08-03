import { useEffect, useMemo, useState } from 'react'
import {
  api,
  countCardAbilitySlots,
  MAX_CARD_ABILITIES,
  MAXIMUM_UNIT_PASSIVES,
  maxKeywordsForRarity,
  prepareCardArtFile,
  type Ability,
  type Card,
  type Keyword,
  type Settings,
} from '../api'
import { abilityDisplayRank, orderedAbilityNames } from '../abilityOrder'
import { CardEditor } from '../components/cards/CardEditor'
import { CardList } from '../components/cards/CardList'
import { CardToolbar } from '../components/cards/CardToolbar'
import { emptyCard } from '../components/cards/emptyCard'

export function CardsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [abilityCatalog, setAbilityCatalog] = useState<Ability[]>([])
  const [keywordCatalog, setKeywordCatalog] = useState<Keyword[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Card | null>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [race, setRace] = useState('')
  const [rarity, setRarity] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [artNonce, setArtNonce] = useState(0)
  const [artFileName, setArtFileName] = useState('')
  const [artPreviewUrl, setArtPreviewUrl] = useState<string | null>(null)
  const [artUploading, setArtUploading] = useState(false)

  const selected = useMemo(
    () => cards.find((c) => c.id === selectedId) ?? null,
    [cards, selectedId],
  )

  const abilityByName = useMemo(() => {
    const map = new Map<string, Ability>()
    for (const ability of abilityCatalog) {
      map.set(ability.name, ability)
    }
    return map
  }, [abilityCatalog])

  const keywordByName = useMemo(() => {
    const map = new Map<string, Keyword>()
    for (const keyword of keywordCatalog) {
      map.set(keyword.name, keyword)
    }
    return map
  }, [keywordCatalog])

  async function loadCards(search = q) {
    const result = await api.cards({ q: search, type, race, rarity })
    setCards(result.cards)
    if (!selectedId && result.cards[0]) {
      setSelectedId(result.cards[0].id)
    }
  }

  useEffect(() => {
    void (async () => {
      const results = await Promise.allSettled([
        api.settings(),
        api.abilities(),
        api.keywords(),
      ])
      const errors: string[] = []
      if (results[0].status === 'fulfilled') setSettings(results[0].value)
      else errors.push(results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason))
      if (results[1].status === 'fulfilled') setAbilityCatalog(results[1].value.abilities ?? [])
      else errors.push(results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason))
      if (results[2].status === 'fulfilled') setKeywordCatalog(results[2].value.keywords ?? [])
      else errors.push(results[2].reason instanceof Error ? results[2].reason.message : String(results[2].reason))
      if (errors.length) setError(errors.join(' · '))
    })()
  }, [])

  useEffect(() => {
    void loadCards(q).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, race, rarity])

  useEffect(() => {
    if (selected) {
      setDraft({
        ...selected,
        abilities: [...(selected.abilities || [])],
        keywords: [...(selected.keywords || [])],
        tags: [...(selected.tags || [])],
      })
      setArtFileName(selected.hasArt ? 'Saved image' : '')
      setArtPreviewUrl(null)
    }
  }, [selected])

  useEffect(() => {
    return () => {
      if (artPreviewUrl) URL.revokeObjectURL(artPreviewUrl)
    }
  }, [artPreviewUrl])

  function patch<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save() {
    if (!draft) return
    if (countCardAbilitySlots(draft.abilities ?? [], draft.ultimate) > MAX_CARD_ABILITIES) {
      setError(
        `Cards can have at most ${MAX_CARD_ABILITIES} abilities (including ultimate).`,
      )
      return
    }
    if (draft.cardType === 'Unit') {
      const passiveCount = (draft.abilities ?? []).filter(
        (name) => abilityDisplayRank(abilityByName.get(name)) === 0,
      ).length
      if (passiveCount > MAXIMUM_UNIT_PASSIVES) {
        setError(
          `Units can have at most ${MAXIMUM_UNIT_PASSIVES} passives (got ${passiveCount}).`,
        )
        return
      }
    }
    const maxKw = maxKeywordsForRarity(draft.rarity)
    const uniqueKeywords = [
      ...new Set((draft.keywords ?? []).map((k) => k.trim()).filter(Boolean)),
    ]
    if (uniqueKeywords.length > maxKw) {
      setError(
        `${draft.rarity || 'Card'} can have at most ${maxKw} keywords (got ${uniqueKeywords.length}).`,
      )
      return
    }
    const combatRequired = ['Unit', 'Officer', 'Commander'].includes(draft.cardType)
    if (combatRequired) {
      const missing = (
        [
          ['move', draft.move],
          ['damage', draft.damage],
          ['range', draft.range],
          ['toughness', draft.toughness],
        ] as const
      )
        .filter(([, v]) => v == null || Number(v) <= 0)
        .map(([k]) => k)
      if (missing.length) {
        setError(
          `${draft.cardType} cards require Move, Damage, Range, and Toughness (all > 0). Missing/invalid: ${missing.join(', ')}.`,
        )
        return
      }
    }
    try {
      const ordered = {
        ...draft,
        keywords: uniqueKeywords,
        abilities: orderedAbilityNames(draft.abilities ?? [], abilityByName),
      }
      const { card } = await api.saveCard(ordered)
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

  async function uploadArt(file: File | null) {
    if (!draft || !file) return
    setArtUploading(true)
    setError('')
    try {
      const prepared = await prepareCardArtFile(file)
      if (artPreviewUrl) URL.revokeObjectURL(artPreviewUrl)
      const preview = URL.createObjectURL(prepared)
      setArtPreviewUrl(preview)
      setArtFileName(prepared.name)
      const { card } = await api.uploadArt(draft.id, prepared)
      setStatus(`Art uploaded for ${card.name}`)
      setArtNonce((n) => n + 1)
      setDraft(card)
      setCards((prev) => prev.map((item) => (item.id === card.id ? card : item)))
      setArtFileName(prepared.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (artPreviewUrl) {
        URL.revokeObjectURL(artPreviewUrl)
      }
      setArtPreviewUrl(null)
      setArtFileName('')
    } finally {
      setArtUploading(false)
    }
  }

  async function clearArt() {
    if (!draft?.hasArt && !artPreviewUrl) return
    if (!window.confirm(`Remove art for ${draft?.name}?`)) return
    try {
      if (!draft) return
      const { card } = await api.clearArt(draft.id)
      setStatus(`Cleared art for ${card.name}`)
      setArtNonce((n) => n + 1)
      setArtPreviewUrl(null)
      setArtFileName('')
      setDraft(card)
      setCards((prev) => prev.map((item) => (item.id === card.id ? card : item)))
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

      <CardToolbar
        q={q}
        type={type}
        race={race}
        rarity={rarity}
        settings={settings}
        onQueryChange={setQ}
        onTypeChange={setType}
        onRaceChange={setRace}
        onRarityChange={setRarity}
      />
      <p className="muted">
        {cards.length} shown{status ? ` · ${status}` : ''}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="layout-split">
        <CardList cards={cards} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="panel">
          {draft ? (
            <CardEditor
              draft={draft}
              settings={settings}
              abilityByName={abilityByName}
              keywordByName={keywordByName}
              artNonce={artNonce}
              artPreviewUrl={artPreviewUrl}
              artFileName={artFileName}
              artUploading={artUploading}
              onPatch={patch}
              onError={setError}
              onUploadArt={(file) => void uploadArt(file)}
              onClearArt={() => void clearArt()}
            />
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
