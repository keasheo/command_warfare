import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Ability } from '../api'

export function AbilitiesPage() {
  const [abilities, setAbilities] = useState<Ability[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Ability | null>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState('All')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const current = useMemo(
    () => abilities.find((a) => a.name === selected) ?? null,
    [abilities, selected],
  )

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
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save() {
    if (!draft) return
    try {
      const { ability } = await api.saveAbility(draft)
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
          <p>Library of passives, actives, and ultimates</p>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={!draft}>
          Save
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search abilities…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {['All', 'Passive', 'Active', 'Ultimate'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <p className="muted">
        {abilities.length} shown{status ? ` · ${status}` : ''}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="layout-split">
        <div className="panel">
          <div className="panel-scroll">
            {abilities.map((ability) => (
              <button
                key={ability.name}
                className={`list-item${ability.name === selected ? ' active' : ''}`}
                onClick={() => setSelected(ability.name)}
              >
                <div>{ability.name}</div>
                <div className="meta">
                  {ability.type}
                  {ability.cost ? ` · ${ability.cost}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          {draft ? (
            <div className="form-grid panel-scroll">
              <Field label="Name" className="span-2">
                <input value={draft.name} readOnly />
              </Field>
              <Field label="Type">
                <select
                  value={draft.type ?? 'Active'}
                  onChange={(e) => patch('type', e.target.value)}
                >
                  {['Passive', 'Active', 'Ultimate'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cost">
                <input
                  value={draft.cost ?? ''}
                  onChange={(e) => patch('cost', e.target.value || null)}
                />
              </Field>
              <Field label="Cost Amount">
                <input
                  value={draft.costAmount ?? ''}
                  onChange={(e) =>
                    patch(
                      'costAmount',
                      e.target.value.trim() ? Number(e.target.value) : null,
                    )
                  }
                />
              </Field>
              <Field label="Cost Resource">
                <input
                  value={draft.costResource ?? ''}
                  onChange={(e) => patch('costResource', e.target.value || null)}
                />
              </Field>
              <Field label="Affects">
                <input
                  value={draft.affects ?? ''}
                  onChange={(e) => patch('affects', e.target.value || null)}
                />
              </Field>
              <Field label="Affect Count">
                <input
                  value={draft.affectCount ?? ''}
                  onChange={(e) =>
                    patch(
                      'affectCount',
                      e.target.value.trim() ? Number(e.target.value) : null,
                    )
                  }
                />
              </Field>
              <Field label="Radius From">
                <input
                  value={draft.radiusFrom ?? ''}
                  onChange={(e) => patch('radiusFrom', e.target.value || null)}
                />
              </Field>
              <Field label="Radius Size">
                <input
                  value={draft.radiusSize ?? ''}
                  onChange={(e) =>
                    patch(
                      'radiusSize',
                      e.target.value.trim() ? Number(e.target.value) : null,
                    )
                  }
                />
              </Field>
              <Field label="Used By">
                <input
                  value={draft.usedBy ?? ''}
                  onChange={(e) => patch('usedBy', e.target.value || null)}
                />
              </Field>
              <Field label="Tags" className="span-2">
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
              <Field label="Description" className="span-3">
                <textarea
                  rows={8}
                  value={draft.description ?? ''}
                  onChange={(e) => patch('description', e.target.value || null)}
                />
              </Field>
            </div>
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
