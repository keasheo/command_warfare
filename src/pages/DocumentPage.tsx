import { useEffect, useMemo, useState } from 'react'
import { api, type DocPayload, type DocSection } from '../api'

type FlatSection = {
  id: string
  title: string
  body: string
  depth: number
}

function flattenSections(sections: DocSection[] = [], depth = 0): FlatSection[] {
  const rows: FlatSection[] = []
  for (const section of sections) {
    const id = section.id || `${depth}-${section.title || 'section'}-${rows.length}`
    rows.push({
      id,
      title: section.title || 'Untitled',
      body: section.body || '',
      depth,
    })
    if (section.children?.length) {
      rows.push(...flattenSections(section.children, depth + 1))
    }
  }
  return rows
}

export function DocumentPage({
  slug,
  heading,
}: {
  slug: 'rulebook' | 'design_bible'
  heading: string
}) {
  const [doc, setDoc] = useState<DocPayload | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void api
      .document(slug)
      .then((payload) => {
        setDoc(payload.document)
        const flat = flattenSections(payload.document.sections ?? [])
        setSelectedId(flat[0]?.id ?? null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [slug])

  const flat = useMemo(() => flattenSections(doc?.sections ?? []), [doc])
  const selected = flat.find((row) => row.id === selectedId) ?? flat[0]

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{heading}</h2>
          <p>{doc?.title || 'Reference document'}</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!doc && !error ? <p className="muted">Loading…</p> : null}
      {doc ? (
        <div className="doc-tree">
          <div className="panel">
            <div className="panel-scroll">
              {flat.map((row) => (
                <button
                  key={row.id}
                  className={`list-item${row.id === selected?.id ? ' active' : ''}`}
                  style={{ paddingLeft: `${0.85 + row.depth * 0.75}rem` }}
                  onClick={() => setSelectedId(row.id)}
                >
                  {row.title}
                </button>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>{selected?.title}</h3>
            <div className="doc-body">{selected?.body || 'No body text.'}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
