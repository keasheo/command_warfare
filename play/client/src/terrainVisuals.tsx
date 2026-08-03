/** Shared SVG defs for volcanic terrain — cracked obsidian with magma vein texture. */
export const VOLCANIC_PATTERN_ID = 'terrain-volcanic-magma'

/** Charcoal rim — matches cooled obsidian plates at crack edges. */
export const VOLCANIC_STROKE = '#3a2620'

const VOLCANIC_GLOW_FILTER_ID = 'terrain-volcanic-glow'

/** Tile the texture ~2.4× across a hex bbox so cracks stay readable at board scale. */
const VOLCANIC_PATTERN_TILE = 0.42

/** Jagged crack segments — hand-authored to avoid V/chevron/arrowhead bright junctions. */
const VOLCANIC_CRACKS: ReadonlyArray<{
  d: string
  stroke: string
  width: number
  opacity: number
}> = [
  // Primary meandering vein — horizontal bias, no converging pair at any tip
  {
    d: 'M 0.02 0.58 L 0.08 0.54 L 0.14 0.60 L 0.21 0.55 L 0.28 0.62 L 0.36 0.57 L 0.44 0.63 L 0.52 0.59 L 0.60 0.64 L 0.68 0.60 L 0.76 0.65 L 0.84 0.61 L 0.92 0.66 L 0.98 0.62',
    stroke: '#5c0e0a',
    width: 0.022,
    opacity: 0.92,
  },
  {
    d: 'M 0.02 0.58 L 0.08 0.54 L 0.14 0.60 L 0.21 0.55 L 0.28 0.62 L 0.36 0.57 L 0.44 0.63 L 0.52 0.59 L 0.60 0.64 L 0.68 0.60 L 0.76 0.65 L 0.84 0.61 L 0.92 0.66 L 0.98 0.62',
    stroke: '#ae281e',
    width: 0.012,
    opacity: 0.84,
  },
  // Single branch upward — terminates before other veins
  {
    d: 'M 0.21 0.55 L 0.23 0.46 L 0.25 0.38 L 0.24 0.30 L 0.26 0.22',
    stroke: '#6b1210',
    width: 0.013,
    opacity: 0.82,
  },
  {
    d: 'M 0.21 0.55 L 0.23 0.46 L 0.25 0.38 L 0.24 0.30 L 0.26 0.22',
    stroke: '#c43828',
    width: 0.007,
    opacity: 0.72,
  },
  // Offset diagonal vein — obtuse zigzag, no tip convergence
  {
    d: 'M 0.04 0.18 L 0.10 0.24 L 0.08 0.32 L 0.15 0.38 L 0.12 0.46 L 0.19 0.52 L 0.16 0.40',
    stroke: '#4a0a08',
    width: 0.018,
    opacity: 0.88,
  },
  {
    d: 'M 0.04 0.18 L 0.10 0.24 L 0.08 0.32 L 0.15 0.38 L 0.12 0.46 L 0.19 0.52 L 0.16 0.40',
    stroke: '#8c2018',
    width: 0.010,
    opacity: 0.78,
  },
  // Lower-right wandering crack
  {
    d: 'M 0.48 0.72 L 0.54 0.68 L 0.58 0.74 L 0.64 0.70 L 0.70 0.76 L 0.78 0.72 L 0.86 0.78 L 0.94 0.74',
    stroke: '#5c0e0a',
    width: 0.016,
    opacity: 0.85,
  },
  {
    d: 'M 0.48 0.72 L 0.54 0.68 L 0.58 0.74 L 0.64 0.70 L 0.70 0.76 L 0.78 0.72 L 0.86 0.78 L 0.94 0.74',
    stroke: '#9c2a20',
    width: 0.009,
    opacity: 0.74,
  },
  // Downward fork from main vein — asymmetric, one branch only
  {
    d: 'M 0.52 0.59 L 0.54 0.68 L 0.53 0.76 L 0.55 0.84',
    stroke: '#6b1210',
    width: 0.012,
    opacity: 0.8,
  },
  // Upper-right isolated segment
  {
    d: 'M 0.62 0.12 L 0.68 0.18 L 0.66 0.26 L 0.72 0.32 L 0.70 0.40 L 0.76 0.46',
    stroke: '#4a0a08',
    width: 0.015,
    opacity: 0.86,
  },
  {
    d: 'M 0.62 0.12 L 0.68 0.18 L 0.66 0.26 L 0.72 0.32 L 0.70 0.40 L 0.76 0.46',
    stroke: '#a42820',
    width: 0.008,
    opacity: 0.76,
  },
  // Left-edge vertical meander
  {
    d: 'M 0.06 0.08 L 0.08 0.16 L 0.05 0.24 L 0.09 0.32 L 0.06 0.40 L 0.10 0.48',
    stroke: '#5c0e0a',
    width: 0.014,
    opacity: 0.84,
  },
  // Mid-field short crack — dark orange core only
  {
    d: 'M 0.32 0.28 L 0.38 0.32 L 0.42 0.28 L 0.46 0.34 L 0.50 0.30',
    stroke: '#8c2018',
    width: 0.011,
    opacity: 0.80,
  },
  // Faint background veins for depth — very dark, no bright cores
  {
    d: 'M 0.10 0.82 L 0.18 0.78 L 0.26 0.84 L 0.34 0.80 L 0.42 0.86',
    stroke: '#3c1212',
    width: 0.020,
    opacity: 0.60,
  },
  {
    d: 'M 0.58 0.38 L 0.64 0.42 L 0.62 0.50 L 0.68 0.54 L 0.66 0.62',
    stroke: '#3c1212',
    width: 0.018,
    opacity: 0.55,
  },
  {
    d: 'M 0.78 0.08 L 0.82 0.14 L 0.80 0.22 L 0.86 0.28',
    stroke: '#4a1414',
    width: 0.012,
    opacity: 0.65,
  },
]

export function volcanicFill(): string {
  return `url(#${VOLCANIC_PATTERN_ID})`
}

export function VolcanicMagmaPattern() {
  return (
    <>
      <filter
        id={VOLCANIC_GLOW_FILTER_ID}
        x="-15%"
        y="-15%"
        width="130%"
        height="130%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.005" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="1.1 0 0 0 0  0 0.25 0 0 0  0 0 0.15 0 0  0 0 0 0.52 0"
          result="redBloom"
        />
        <feMerge>
          <feMergeNode in="redBloom" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <pattern
        id={VOLCANIC_PATTERN_ID}
        patternUnits="objectBoundingBox"
        patternContentUnits="objectBoundingBox"
        width={VOLCANIC_PATTERN_TILE}
        height={VOLCANIC_PATTERN_TILE}
      >
        <rect width={1} height={1} fill="#201816" />
        <rect width={1} height={1} fill="#2a241e" opacity={0.30} />
        <g filter={`url(#${VOLCANIC_GLOW_FILTER_ID})`}>
          {VOLCANIC_CRACKS.map(({ d, stroke, width, opacity }, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={width}
              strokeOpacity={opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      </pattern>
    </>
  )
}

/** @deprecated Use VolcanicMagmaPattern — kept for existing imports during transition. */
export const VolcanicMagmaGradient = VolcanicMagmaPattern
