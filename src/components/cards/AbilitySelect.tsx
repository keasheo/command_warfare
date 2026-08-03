import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { Ability } from '../../api'
import { formatAbilityCost } from '../abilities/abilityFormat'

export type CatalogSelectOption = {
  name: string
  description?: string | null
  meta?: string
  disabled?: boolean
  warning?: string
}

/** Searchable select with a description popover panel. */
export function CatalogSelect({
  value,
  options,
  onChange,
  emptyLabel = '—',
  placeholder = 'Search…',
  className = '',
}: {
  value: string
  options: CatalogSelectOption[]
  onChange: (name: string) => void
  emptyLabel?: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeName, setActiveName] = useState<string | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selected = useMemo(
    () => options.find((option) => option.name === value) ?? null,
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) => {
      const hay = [option.name, option.meta, option.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [options, query])

  const preview =
    (activeName &&
      (filtered.find((o) => o.name === activeName) ??
        options.find((o) => o.name === activeName))) ||
    selected ||
    filtered[0] ||
    null

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, 420), window.innerWidth - 16)
      let left = rect.left
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8)
      }
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const preferBelow = spaceBelow >= 220
      setMenuStyle({
        position: 'fixed',
        top: preferBelow ? rect.bottom + 4 : undefined,
        bottom: preferBelow ? undefined : window.innerHeight - rect.top + 4,
        left,
        width,
        zIndex: 80,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveName(value || filtered[0]?.name || null)
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function choose(name: string) {
    onChange(name)
    setOpen(false)
  }

  function onListKeyDown(event: ReactKeyboardEvent) {
    if (!filtered.length) return
    const index = Math.max(
      0,
      filtered.findIndex((option) => option.name === activeName),
    )
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveName(filtered[(index + 1) % filtered.length].name)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveName(filtered[(index - 1 + filtered.length) % filtered.length].name)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const current = filtered[index]
      if (current && !current.disabled) choose(current.name)
    }
  }

  const triggerLabel = value
    ? selected?.warning
      ? `${value} (${selected.warning})`
      : value
    : emptyLabel

  return (
    <div
      className={`ability-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ability-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={value ? undefined : 'muted'}>{triggerLabel}</span>
        <span className="ability-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {value && selected?.description ? (
        <p className="ability-select-summary" title={selected.description}>
          {selected.description}
        </p>
      ) : null}

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="ability-select-popover"
              style={menuStyle}
              role="presentation"
              onWheel={(event) => event.stopPropagation()}
            >
              <input
                ref={searchRef}
                className="ability-select-search"
                value={query}
                placeholder={placeholder}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKeyDown}
                aria-controls={listId}
              />
              <div className="ability-select-body">
                <ul id={listId} className="ability-select-list" role="listbox">
                  <li role="option" aria-selected={!value}>
                    <button
                      type="button"
                      className={!value ? 'is-active' : undefined}
                      onMouseEnter={() => setActiveName(null)}
                      onClick={() => choose('')}
                    >
                      {emptyLabel}
                    </button>
                  </li>
                  {filtered.map((option) => (
                    <li
                      key={option.name}
                      role="option"
                      aria-selected={option.name === value}
                      aria-disabled={option.disabled || undefined}
                    >
                      <button
                        type="button"
                        className={
                          [
                            option.name === value ? 'is-selected' : '',
                            option.name === activeName ? 'is-active' : '',
                            option.disabled ? 'is-disabled' : '',
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                        disabled={option.disabled}
                        onMouseEnter={() => setActiveName(option.name)}
                        onFocus={() => setActiveName(option.name)}
                        onClick={() => {
                          if (!option.disabled) choose(option.name)
                        }}
                      >
                        <span className="ability-select-option-name">
                          {option.name}
                          {option.warning ? ` (${option.warning})` : ''}
                        </span>
                        {option.meta ? (
                          <span className="ability-select-option-meta">{option.meta}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {!filtered.length ? (
                    <li className="ability-select-empty muted">No matches</li>
                  ) : null}
                </ul>
                <div className="ability-select-desc" aria-live="polite">
                  {preview ? (
                    <>
                      <strong>{preview.name}</strong>
                      {preview.meta ? (
                        <div className="ability-select-desc-meta">{preview.meta}</div>
                      ) : null}
                      <p>
                        {preview.description?.trim() || 'No description available.'}
                      </p>
                    </>
                  ) : (
                    <p className="muted">Hover an option to preview its description.</p>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export type AbilitySelectOption = {
  name: string
  ability?: Ability
  disabled?: boolean
  warning?: string
}

function abilityMeta(ability: Ability | undefined): string | undefined {
  if (!ability) return undefined
  return [ability.type, formatAbilityCost(ability), ability.usedBy]
    .filter(Boolean)
    .join(' · ')
}

/** Ability picker wired to CatalogSelect with cost/type meta. */
export function AbilitySelect({
  value,
  options,
  onChange,
  emptyLabel = '—',
  placeholder = 'Select ability…',
}: {
  value: string
  options: AbilitySelectOption[]
  onChange: (name: string) => void
  emptyLabel?: string
  placeholder?: string
}) {
  const catalogOptions: CatalogSelectOption[] = options.map((option) => ({
    name: option.name,
    description: option.ability?.description,
    meta: abilityMeta(option.ability),
    disabled: option.disabled,
    warning: option.warning,
  }))
  return (
    <CatalogSelect
      value={value}
      options={catalogOptions}
      onChange={onChange}
      emptyLabel={emptyLabel}
      placeholder={placeholder}
    />
  )
}
