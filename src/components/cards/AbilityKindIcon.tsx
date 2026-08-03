const ICON_COLORS = {
  passive: '#37699b',
  active: '#5f4682',
  ultimate: '#963737',
  ink: '#f8f1e3',
  edge: '#2a241e',
} as const

export function AbilityKindIcon({
  kind,
}: {
  kind: 'passive' | 'active' | 'ultimate'
}) {
  const title =
    kind === 'passive' ? 'Passive' : kind === 'active' ? 'Active' : 'Ultimate'
  const fill = ICON_COLORS[kind]
  const ink = ICON_COLORS.ink
  const edge = ICON_COLORS.edge

  return (
    <svg
      className={`kb-ability-icon kind-${kind}`}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-label={title}
      role="img"
    >
      {kind === 'passive' ? (
        <>
          <circle cx="10" cy="10" r="8.5" fill={fill} stroke={edge} strokeWidth="1" />
          <path
            fill={ink}
            d="M10 3.4 11.15 7.45 15.4 7.55 12 10.05 13.25 14.2 10 11.85 6.75 14.2 8 10.05 4.6 7.55 8.85 7.45Z"
          />
        </>
      ) : null}
      {kind === 'active' ? (
        <>
          <path
            fill={fill}
            stroke={edge}
            strokeWidth="1"
            strokeLinejoin="round"
            d="M3.2 3.4 H16.8 V10.2 L10 18.2 L3.2 10.2 Z"
          />
          <circle cx="10" cy="9.2" r="3.1" fill="none" stroke={ink} strokeWidth="1.5" />
          <circle cx="10" cy="9.2" r="1.05" fill={ink} />
        </>
      ) : null}
      {kind === 'ultimate' ? (
        <>
          <path
            fill={fill}
            stroke={edge}
            strokeWidth="1"
            strokeLinejoin="round"
            d="M10 1.3 L12.15 7.7 L18.8 7.8 L13.4 11.7 L15.5 18.2 L10 14.5 L4.5 18.2 L6.6 11.7 L1.2 7.8 L7.85 7.7 Z"
          />
          <path
            fill={ink}
            d="M10 5.4 L11.05 8.45 L14.2 8.5 L11.7 10.35 L12.7 13.35 L10 11.65 L7.3 13.35 L8.3 10.35 L5.8 8.5 L8.95 8.45 Z"
          />
        </>
      ) : null}
    </svg>
  )
}
