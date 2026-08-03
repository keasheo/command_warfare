export function KeywordsToolbar({
  q,
  onQChange,
}: {
  q: string
  onQChange: (value: string) => void
}) {
  return (
    <div className="toolbar">
      <input
        type="search"
        placeholder="Search keywords…"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
      />
    </div>
  )
}
