export function AbilitiesToolbar({
  q,
  type,
  usedByFilter,
  onQChange,
  onTypeChange,
  onUsedByChange,
}: {
  q: string
  type: string
  usedByFilter: string
  onQChange: (value: string) => void
  onTypeChange: (value: string) => void
  onUsedByChange: (value: string) => void
}) {
  return (
    <div className="toolbar">
      <input
        type="search"
        placeholder="Search abilities…"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
      />
      <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
        {['All', 'Passive', 'Active', 'Ultimate'].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <select value={usedByFilter} onChange={(e) => onUsedByChange(e.target.value)}>
        {[
          ['All', 'All tiers'],
          ['Commander', 'Commander'],
          ['Officer', 'Officer'],
          ['Unit', 'Unit'],
          ['Both', 'Both (Officer+Unit)'],
        ].map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
