export function CardBorderOrnament() {
  return (
    <svg
      className="card-border-ornament"
      viewBox="0 0 400 560"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      <defs>
        {/* Corner filigree pattern - flowing scrollwork */}
        <g id="corner-ornament">
          {/* Outer flowing curve */}
          <path
            d="M 0 0 Q 2 8, 8 8 Q 12 8, 14 12 Q 16 16, 20 16 L 22 16"
            stroke="#a8946f"
            strokeWidth="1.5"
            fill="none"
            opacity="0.7"
          />
          {/* Inner delicate scroll */}
          <path
            d="M 2 2 Q 4 6, 7 6 Q 9 6, 10 8 Q 11 10, 13 11"
            stroke="#baa781"
            strokeWidth="1"
            fill="none"
            opacity="0.5"
          />
          {/* Small accent curl */}
          <circle cx="6" cy="6" r="1.5" fill="#a8946f" opacity="0.4" />
          <path
            d="M 6 6 Q 8 4, 10 4"
            stroke="#a8946f"
            strokeWidth="0.8"
            fill="none"
            opacity="0.6"
          />
        </g>
      </defs>

      {/* Dark outer border - soft rounded rectangle */}
      <rect
        x="4"
        y="4"
        width="392"
        height="552"
        rx="10"
        ry="10"
        fill="none"
        stroke="#2a241e"
        strokeWidth="4"
      />

      {/* Inner subtle gold border - slightly irregular */}
      <rect
        x="7.5"
        y="7.5"
        width="385"
        height="545"
        rx="9"
        ry="9"
        fill="none"
        stroke="#a8946f"
        strokeWidth="1.5"
        opacity="0.6"
      />

      {/* Corner ornaments - top-left */}
      <g transform="translate(12, 12)">
        <use href="#corner-ornament" />
      </g>

      {/* Corner ornaments - top-right */}
      <g transform="translate(388, 12) scale(-1, 1)">
        <use href="#corner-ornament" />
      </g>

      {/* Corner ornaments - bottom-left (lighter, more inset to avoid terrain icon) */}
      <g transform="translate(12, 548) scale(1, -1)" opacity="0.5">
        <use href="#corner-ornament" />
      </g>

      {/* Corner ornaments - bottom-right (lighter, more inset to avoid rarity gem) */}
      <g transform="translate(388, 548) scale(-1, -1)" opacity="0.5">
        <use href="#corner-ornament" />
      </g>

      {/* Subtle edge accent lines - adds organic irregularity */}
      <path
        d="M 60 8 Q 100 6, 140 8 Q 180 6, 220 8 Q 260 6, 300 8 Q 320 6, 340 8"
        stroke="#baa781"
        strokeWidth="0.8"
        fill="none"
        opacity="0.3"
      />
      <path
        d="M 60 552 Q 100 554, 140 552 Q 180 554, 220 552 Q 260 554, 300 552 Q 320 554, 340 552"
        stroke="#baa781"
        strokeWidth="0.8"
        fill="none"
        opacity="0.3"
      />
    </svg>
  )
}
