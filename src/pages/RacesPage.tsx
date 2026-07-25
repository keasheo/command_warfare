import { useEffect, useState } from 'react'
import { api } from '../api'

export function RacesPage() {
  const [races, setRaces] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void api
      .settings()
      .then((settings) => {
        setRaces(settings.races)
        setDraft(settings.races.join('\n'))
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  async function save() {
    const next = draft
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    try {
      const result = await api.saveRaces(next)
      setRaces(result.races)
      setDraft(result.races.join('\n'))
      setStatus(`Saved ${result.races.length} races`)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Races</h2>
          <p>One race per line · used by card filters and editors</p>
        </div>
        <button className="btn primary" onClick={() => void save()}>
          Save
        </button>
      </div>
      {status ? <p className="muted">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="panel" style={{ padding: '1rem' }}>
        <textarea
          rows={16}
          style={{ width: '100%' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Current count: {races.length}
        </p>
      </div>
    </div>
  )
}
