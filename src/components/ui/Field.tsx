import type { ReactNode } from 'react'

export function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </div>
  )
}
