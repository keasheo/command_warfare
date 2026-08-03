import { useEffect, useMemo, useState } from 'react'
import { ApiError, api, type Keyword, type KeywordCardRef } from '../api'
import { KeywordEditor } from '../components/keywords/KeywordEditor'
import { KeywordList } from '../components/keywords/KeywordList'
import { KeywordDeleteBlocked } from '../components/keywords/KeywordDeleteBlocked'
import { KeywordsToolbar } from '../components/keywords/KeywordsToolbar'

function emptyKeyword(): Keyword {
  return {
    name: '',
    description: '',
    tags: [],
    usageCount: 0,
  }
}

export function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Keyword | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [usageCards, setUsageCards] = useState<KeywordCardRef[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [deleteBlocked, setDeleteBlocked] = useState<{
    message: string
    cards: KeywordCardRef[]
  } | null>(null)
  const [descriptionInvalid, setDescriptionInvalid] = useState(false)

  const current = useMemo(
    () => (isNew ? null : keywords.find((k) => k.name === selected) ?? null),
    [keywords, selected, isNew],
  )

  async function load(preferred?: string | null) {
    const result = await api.keywords(q ? { q } : {})
    setKeywords(result.keywords)
    const nextSelected =
      preferred ??
      selected ??
      result.keywords[0]?.name ??
      null
    if (nextSelected && result.keywords.some((k) => k.name === nextSelected)) {
      setSelected(nextSelected)
      setIsNew(false)
    } else if (!result.keywords.length) {
      setSelected(null)
      setDraft(null)
      setIsNew(false)
    } else if (!isNew) {
      setSelected(result.keywords[0].name)
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    if (isNew) return
    if (!current) {
      setDraft(null)
      setUsageCards([])
      return
    }
    setDraft({ ...current, tags: [...(current.tags ?? [])] })
    setDescriptionInvalid(!String(current.description ?? '').trim())
    setDeleteBlocked(null)
    void api
      .keywordUsage(current.name)
      .then((result) => setUsageCards(result.cards))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [current, isNew])

  function patch<K extends keyof Keyword>(key: K, value: Keyword[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    if (key === 'description' && String(value ?? '').trim()) {
      setDescriptionInvalid(false)
    }
  }

  function startNew() {
    setIsNew(true)
    setSelected(null)
    setDraft(emptyKeyword())
    setUsageCards([])
    setDeleteBlocked(null)
    setStatus('')
    setError('')
  }

  async function save() {
    if (!draft) return
    const name = draft.name.trim()
    const description = (draft.description ?? '').trim()
    if (!name) {
      setError('Keyword name is required.')
      return
    }
    if (!description) {
      setDescriptionInvalid(true)
      setError('Keyword description is required.')
      return
    }
    try {
      const { keyword } = await api.saveKeyword({
        ...draft,
        name,
        description,
        tags: draft.tags ?? [],
      })
      setStatus(`Saved ${keyword.name}`)
      setError('')
      setDeleteBlocked(null)
      setIsNew(false)
      await load(keyword.name)
      setSelected(keyword.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove() {
    if (!draft?.name || isNew) return
    setDeleteBlocked(null)
    try {
      // Refresh usage first so the user sees who has it if blocked.
      const usage = await api.keywordUsage(draft.name)
      if (usage.usageCount > 0) {
        setUsageCards(usage.cards)
        setDeleteBlocked({
          message: `Cannot delete '${draft.name}' — used by ${usage.usageCount} card${usage.usageCount === 1 ? '' : 's'}. Remove it from these cards first:`,
          cards: usage.cards,
        })
        setError('')
        return
      }
      await api.deleteKeyword(draft.name)
      setStatus(`Deleted ${draft.name}`)
      setError('')
      setDeleteBlocked(null)
      setSelected(null)
      setDraft(null)
      await load(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const cards = (err.payload.cards as KeywordCardRef[]) || []
        setUsageCards(cards)
        setDeleteBlocked({
          message: String(err.message),
          cards,
        })
        setError('')
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Keywords</h2>
          <p>
            Shared keyword rules text shown on cards. Every keyword needs a rules description.
            Keywords can only be deleted when no cards use them.
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn" type="button" onClick={startNew}>
            New keyword
          </button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={!draft}>
            Save
          </button>
          <button
            className="btn danger"
            type="button"
            onClick={() => void remove()}
            disabled={!draft || isNew}
          >
            Delete
          </button>
        </div>
      </div>

      <KeywordsToolbar q={q} onQChange={setQ} />
      <p className="muted">
        {keywords.length} shown{status ? ` · ${status}` : ''}
      </p>
      {error ? <p className="error">{error}</p> : null}
      {deleteBlocked ? (
        <KeywordDeleteBlocked message={deleteBlocked.message} cards={deleteBlocked.cards} />
      ) : null}

      <div className="layout-split">
        <KeywordList
          keywords={keywords}
          selected={isNew ? null : selected}
          onSelect={(name) => {
            setIsNew(false)
            setSelected(name)
            setDeleteBlocked(null)
          }}
        />
        <div className="panel">
          {draft ? (
            <KeywordEditor
              draft={draft}
              isNew={isNew}
              usageCards={usageCards}
              descriptionInvalid={descriptionInvalid}
              onPatch={patch}
            />
          ) : (
            <p className="muted" style={{ padding: '1rem' }}>
              Select a keyword
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
