import { useEffect, useMemo, useState } from 'react'
import { api, type Ability } from '../api'
import { AbilityEditor } from '../components/abilities/AbilityEditor'
import { AbilityList } from '../components/abilities/AbilityList'
import { AbilitiesToolbar } from '../components/abilities/AbilitiesToolbar'
import { abilityDescriptionLimitError } from '../abilityDescription'

export function AbilitiesPage() {
  const [abilities, setAbilities] = useState<Ability[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Ability | null>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState('All')
  const [usedByFilter, setUsedByFilter] = useState('All')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const current = useMemo(
    () => abilities.find((a) => a.name === selected) ?? null,
    [abilities, selected],
  )

  const visible = useMemo(() => {
    if (usedByFilter === 'All') return abilities
    return abilities.filter((a) => {
      const u = (a.usedBy || '').trim()
      if (usedByFilter === 'Unit') return !u || u === 'Unit' || u === 'Both'
      if (usedByFilter === 'Both') return u === 'Both'
      return u === usedByFilter
    })
  }, [abilities, usedByFilter])

  async function load() {
    const result = await api.abilities({ q, type })
    setAbilities(result.abilities)
    if (!selected && result.abilities[0]) {
      setSelected(result.abilities[0].name)
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type])

  useEffect(() => {
    if (current) setDraft({ ...current, tags: [...current.tags] })
  }, [current])

  function patch<K extends keyof Ability>(key: K, value: Ability[K]) {
    setDraft((prev) => {
      if (!prev) return prev
      const next = { ...prev, [key]: value }
      if (key === 'costAmount' || key === 'costResource' || key === 'type') {
        if (next.type === 'Passive') next.cost = 'Passive'
        else if (next.type === 'Ultimate') next.cost = next.cost || 'Ultimate'
        else if (next.costAmount != null && next.costResource) {
          next.cost = `${next.costAmount} ${String(next.costResource).toUpperCase()}`
        }
      }
      return next
    })
  }

  async function save() {
    if (!draft) return
    const descError = abilityDescriptionLimitError(draft.description)
    if (descError) {
      setError(descError)
      return
    }
    try {
      const payload = { ...draft }
      if (payload.type === 'Active' && payload.costAmount != null && payload.costResource) {
        payload.cost = `${payload.costAmount} ${String(payload.costResource).toUpperCase()}`
      }
      const { ability } = await api.saveAbility(payload)
      setStatus(`Saved ${ability.name}`)
      setError('')
      await load()
      setSelected(ability.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Abilities</h2>
          <p>
            Actives cost Company AP or Command CC. Cooldown is optional extra gating — not a substitute
            for cost.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => void save()}
          disabled={!draft || Boolean(abilityDescriptionLimitError(draft.description))}
        >
          Save
        </button>
      </div>

      <AbilitiesToolbar
        q={q}
        type={type}
        usedByFilter={usedByFilter}
        onQChange={setQ}
        onTypeChange={setType}
        onUsedByChange={setUsedByFilter}
      />
      <p className="muted">
        {visible.length} shown{status ? ` · ${status}` : ''}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="layout-split">
        <AbilityList
          abilities={visible}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="panel">
          {draft ? (
            <AbilityEditor draft={draft} onPatch={patch} />
          ) : (
            <p className="muted" style={{ padding: '1rem' }}>
              Select an ability
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
