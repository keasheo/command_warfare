import { useEffect, useRef, useState } from 'react'
import { AudioPanel } from './AudioPanel'
import { startBattleMusic } from './battleMusic'
import { unlockSfx } from './sfx'
import './appMenu.css'

export function AppMenu({ variant = 'inline' }: { variant?: 'overlay' | 'inline' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`app-menu app-menu-${variant}`} ref={rootRef}>
      <button
        type="button"
        className={`app-menu-toggle${open ? ' open' : ''}`}
        aria-label="Settings menu"
        aria-expanded={open}
        onClick={() => {
          unlockSfx()
          startBattleMusic()
          setOpen((v) => !v)
        }}
      >
        <span />
        <span />
        <span />
      </button>
      {open ? (
        <div className="app-menu-dropdown" role="dialog" aria-label="Settings">
          <h3>Settings</h3>
          <AudioPanel compact />
        </div>
      ) : null}
    </div>
  )
}
