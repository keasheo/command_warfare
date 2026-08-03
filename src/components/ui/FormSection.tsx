import type { ReactNode } from 'react'

export function FormSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="form-section">
      <header className="form-section-header">
        <h3>{title}</h3>
        {hint ? <p className="muted">{hint}</p> : null}
      </header>
      <div className="form-grid form-section-grid">{children}</div>
    </section>
  )
}
