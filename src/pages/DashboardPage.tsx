import { useEffect, useState } from 'react'
import { api, type Dashboard } from '../api'

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    try {
      setData(await api.dashboard())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function runImport() {
    setImporting(true)
    setMessage('')
    try {
      const result = await api.importYaml()
      setMessage(
        `Imported ${result.cards} cards, ${result.abilities} abilities, ${result.keywords ?? 0} keywords, ${result.documents} docs`,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  if (error && !data) {
    return (
      <div>
        <h2>Dashboard</h2>
        <p className="error">{error}</p>
        <p className="muted">Is the API running? Try `npm run dev`.</p>
        <button className="btn primary" onClick={() => void runImport()} disabled={importing}>
          {importing ? 'Importing…' : 'Import from KingdomsBuilder YAML'}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Roster health for Command Warfare</p>
        </div>
        <button className="btn primary" onClick={() => void runImport()} disabled={importing}>
          {importing ? 'Importing…' : 'Re-import YAML'}
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="stats-cards">
        <div className="stat-card">
          <div className="label">Cards</div>
          <div className="value">{data?.total ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Abilities</div>
          <div className="value">{data?.abilityCount ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Average UV</div>
          <div className="value">{data?.avgUv ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Races</div>
          <div className="value">{data?.byRace.length ?? '—'}</div>
        </div>
      </div>

      <div className="layout-split">
        <div className="panel">
          <div className="panel-scroll" style={{ padding: '0.75rem' }}>
            <h3>By type</h3>
            <table className="table">
              <tbody>
                {(data?.byType ?? []).map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-scroll" style={{ padding: '0.75rem' }}>
            <h3>By rarity</h3>
            <table className="table">
              <tbody>
                {(data?.byRarity ?? []).map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 style={{ marginTop: '1.25rem' }}>By race</h3>
            <table className="table">
              <tbody>
                {(data?.byRace ?? []).map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
