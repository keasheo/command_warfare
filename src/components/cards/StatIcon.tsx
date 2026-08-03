const STAT_INK = '#1c1814'

export function StatIcon({ label }: { label: string }) {
  const key = label.toLowerCase()
  return (
    <svg
      className="kb-stat-icon"
      viewBox="0 0 20 20"
      width="14"
      height="14"
      aria-hidden="true"
    >
      {key === 'uv' ? (
        <path
          fill={STAT_INK}
          d="M10 2.2 11.4 7.2 16.6 7.35 12.4 10.45 14 15.6 10 12.7 6 15.6 7.6 10.45 3.4 7.35 8.6 7.2Z"
        />
      ) : null}
      {key === 'move' ? (
        <path
          fill={STAT_INK}
          d="M7.2 2.4 C9.6 2.1 11.8 3.6 12.1 6.1 C12.3 7.8 11.6 9.3 10.4 10.2 C11.8 10.5 13.1 11.6 13.4 13.4 C13.8 15.8 12.1 17.6 9.8 17.7 C7.6 17.8 5.7 16.2 5.4 14 C5.1 12.2 5.9 10.7 7.2 9.9 C5.8 9.2 4.9 7.6 5.1 5.9 C5.3 3.8 6.1 2.5 7.2 2.4 Z M14.6 4.1 A1.35 1.35 0 1 1 14.6 6.8 A1.35 1.35 0 1 1 14.6 4.1 Z M16.3 7.2 A1.2 1.2 0 1 1 16.3 9.6 A1.2 1.2 0 1 1 16.3 7.2 Z M16.1 10.5 A1.15 1.15 0 1 1 16.1 12.8 A1.15 1.15 0 1 1 16.1 10.5 Z M14.8 13.2 A1.1 1.1 0 1 1 14.8 15.4 A1.1 1.1 0 1 1 14.8 13.2 Z"
        />
      ) : null}
      {key === 'damage' ? (
        <>
          <path
            d="M4.2 15.2 L15.8 4.4"
            stroke={STAT_INK}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M4.2 4.4 L15.8 15.2"
            stroke={STAT_INK}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      ) : null}
      {key === 'range' ? (
        <>
          <circle
            cx="10"
            cy="10"
            r="6.4"
            fill="none"
            stroke={STAT_INK}
            strokeWidth="1.7"
          />
          <circle cx="10" cy="10" r="2" fill={STAT_INK} />
        </>
      ) : null}
      {key === 'toughness' ? (
        <path
          d="M10 2.8 L15.4 5.6 L14.2 13.2 L10 16.4 L5.8 13.2 L4.6 5.6 Z"
          fill="none"
          stroke={STAT_INK}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      ) : null}
      {key === 'ap' ||
      key === 'cc' ||
      key.includes('company') ||
      key.includes('cmd') ? (
        <path
          d="M3.4 15 V8.6 L6.8 11 L10 3.6 L13.2 11 L16.6 8.6 V15 Z"
          fill="none"
          stroke={STAT_INK}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  )
}
