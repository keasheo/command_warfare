import type { Settings } from '../../api'

export function CardToolbar({
  q,
  type,
  race,
  rarity,
  settings,
  onQueryChange,
  onTypeChange,
  onRaceChange,
  onRarityChange,
}: {
  q: string
  type: string
  race: string
  rarity: string
  settings: Settings | null
  onQueryChange: (value: string) => void
  onTypeChange: (value: string) => void
  onRaceChange: (value: string) => void
  onRarityChange: (value: string) => void
}) {
  return (
    <div className="toolbar">
      <input
        type="search"
        placeholder="Search any card value…"
        value={q}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
        <option value="">All types</option>
        {(settings?.cardTypes ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select value={race} onChange={(e) => onRaceChange(e.target.value)}>
        <option value="">All races</option>
        {(settings?.races ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select value={rarity} onChange={(e) => onRarityChange(e.target.value)}>
        <option value="">All rarities</option>
        {(settings?.rarities ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  )
}
