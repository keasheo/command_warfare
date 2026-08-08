/**
 * Board terrain & unit visuals — prototype pass.
 *
 * UPGRADED HERE:
 * - Procedural SVG terrain patterns (all land/water kinds + volcanic)
 * - Hex depth/bevel filters for a layered board feel
 *
 * NOT IN THIS PASS (needs art pipeline later):
 * - Unique glTF models per card / faction
 * - Hand-painted seamless terrain atlases
 * - Animated water, weather, or battle VFX
 */
import type { ReactNode } from 'react'
import type { TerrainKind } from '../../shared/index'

export const VOLCANIC_PATTERN_ID = 'terrain-volcanic-magma'
export const VOLCANIC_STROKE = '#3a2620'

const VOLCANIC_GLOW_FILTER_ID = 'terrain-volcanic-glow'
const HEX_DEPTH_FILTER_ID = 'hex-depth-shadow'
const VOLCANIC_PATTERN_TILE = 1

const TERRAIN_PATTERN_PREFIX = 'terrain-pattern-'

export function terrainPatternId(kind: TerrainKind): string {
  return `${TERRAIN_PATTERN_PREFIX}${kind}`
}

export function terrainPatternFill(kind: TerrainKind): string {
  return `url(#${terrainPatternId(kind)})`
}

export function terrainStroke(kind: TerrainKind): string {
  switch (kind) {
    case 'forest':
      return '#0e280e'
    case 'swamp':
      return '#1a3028'
    case 'hills':
      return '#4a4030'
    case 'water':
      return '#1a4878'
    case 'wall':
      return '#383c48'
    case 'desert':
      return '#8a6828'
    case 'volcanic':
      return VOLCANIC_STROKE
    case 'plains':
    default:
      return '#5a5828'
  }
}

/** Slight vertical lift for hills/walls on the pseudo-3D board. */
export function terrainElevation(kind: TerrainKind | undefined): number {
  switch (kind) {
    case 'hills':
      return 0.22
    case 'wall':
      return 0.28
    case 'forest':
      return 0.08
    case 'volcanic':
      return 0.12
    default:
      return 0
  }
}

export function volcanicFill(): string {
  return `url(#${VOLCANIC_PATTERN_ID})`
}

const VOLCANIC_CRACKS: ReadonlyArray<{
  d: string
  stroke: string
  width: number
  opacity: number
}> = [
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
  {
    d: 'M 0.52 0.59 L 0.54 0.68 L 0.53 0.76 L 0.55 0.84',
    stroke: '#6b1210',
    width: 0.012,
    opacity: 0.8,
  },
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
  {
    d: 'M 0.06 0.08 L 0.08 0.16 L 0.05 0.24 L 0.09 0.32 L 0.06 0.40 L 0.10 0.48',
    stroke: '#5c0e0a',
    width: 0.014,
    opacity: 0.84,
  },
  {
    d: 'M 0.32 0.28 L 0.38 0.32 L 0.42 0.28 L 0.46 0.34 L 0.50 0.30',
    stroke: '#8c2018',
    width: 0.011,
    opacity: 0.80,
  },
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

function TerrainPattern({
  id,
  base,
  accent,
  children,
  tile = 1,
}: {
  id: string
  base: string
  accent?: string
  children?: ReactNode
  tile?: number
}) {
  return (
    <pattern
      id={id}
      patternUnits="objectBoundingBox"
      patternContentUnits="objectBoundingBox"
      width={tile}
      height={tile}
    >
      <rect width={1} height={1} fill={base} />
      {accent ? <rect width={1} height={1} fill={accent} opacity={0.45} /> : null}
      {children}
    </pattern>
  )
}

function PlainsPattern() {
  return (
    <TerrainPattern id={terrainPatternId('plains')} base="#7a8a38" accent="#8a9840">
      {[0.18, 0.5, 0.82].map((x, i) => (
        <circle
          key={`g${i}`}
          cx={x}
          cy={0.28 + i * 0.22}
          r={0.045}
          fill="#98b050"
          opacity={0.75}
        />
      ))}
      {[0.1, 0.38, 0.65, 0.9].map((x, i) => (
        <line
          key={`b${i}`}
          x1={x}
          y1={0.15 + (i * 0.18) % 0.7}
          x2={x + 0.06}
          y2={0.22 + (i * 0.18) % 0.7}
          stroke="#5a5828"
          strokeWidth={0.018}
          opacity={0.6}
        />
      ))}
    </TerrainPattern>
  )
}

function ForestPattern() {
  const trees = [
    [0.25, 0.3],
    [0.62, 0.25],
    [0.78, 0.62],
    [0.35, 0.72],
  ]
  return (
    <TerrainPattern id={terrainPatternId('forest')} base="#1a5020" accent="#123818">
      {trees.map(([tx, ty], i) => (
        <g key={i} opacity={0.85 + (i % 2) * 0.1}>
          <polygon
            points={`${tx},${ty - 0.12} ${tx - 0.09},${ty + 0.04} ${tx + 0.09},${ty + 0.04}`}
            fill="#2a7830"
          />
          <rect x={tx - 0.018} y={ty + 0.04} width={0.036} height={0.08} fill="#4a3018" />
        </g>
      ))}
    </TerrainPattern>
  )
}

function HillsPattern() {
  return (
    <TerrainPattern id={terrainPatternId('hills')} base="#6a5a40" accent="#7a6848">
      <path
        d="M 0 0.85 Q 0.25 0.55 0.5 0.78 T 1 0.72 L 1 1 L 0 1 Z"
        fill="#4a4030"
        opacity={0.65}
      />
      <path
        d="M 0 0.62 Q 0.3 0.38 0.55 0.58 T 1 0.48"
        fill="none"
        stroke="#9a8860"
        strokeWidth={0.035}
        opacity={0.7}
      />
      <path
        d="M 0 0.42 Q 0.35 0.22 0.7 0.38 T 1 0.28"
        fill="none"
        stroke="#8a7850"
        strokeWidth={0.028}
        opacity={0.55}
      />
    </TerrainPattern>
  )
}

function SwampPattern() {
  return (
    <TerrainPattern id={terrainPatternId('swamp')} base="#2a4838" accent="#1e3828">
      {[0.25, 0.55, 0.78].map((y, i) => (
        <path
          key={i}
          d={`M 0 ${y} Q 0.25 ${y - 0.08} 0.5 ${y} T 1 ${y + 0.04}`}
          fill="none"
          stroke="#4a7860"
          strokeWidth={0.032}
          opacity={0.65}
        />
      ))}
      <ellipse cx={0.28} cy={0.68} rx={0.08} ry={0.05} fill="#1a3828" opacity={0.75} />
      <ellipse cx={0.72} cy={0.38} rx={0.07} ry={0.045} fill="#1a3828" opacity={0.65} />
    </TerrainPattern>
  )
}

function WaterPattern() {
  return (
    <TerrainPattern id={terrainPatternId('water')} base="#2868a8" accent="#1a5088">
      {[0.22, 0.48, 0.74].map((y, i) => (
        <path
          key={i}
          d={`M 0 ${y} C 0.2 ${y - 0.1} 0.35 ${y + 0.1} 0.5 ${y} S 0.85 ${y - 0.08} 1 ${y}`}
          fill="none"
          stroke="#68b8f0"
          strokeWidth={0.038}
          opacity={0.75}
        />
      ))}
      <rect width={1} height={1} fill="#4088c8" opacity={0.2} />
    </TerrainPattern>
  )
}

function DesertPattern() {
  return (
    <TerrainPattern id={terrainPatternId('desert')} base="#c89848" accent="#d8a858">
      <path
        d="M 0 0.72 Q 0.3 0.52 0.55 0.72 T 1 0.65 L 1 1 L 0 1 Z"
        fill="#a87830"
        opacity={0.5}
      />
      <path
        d="M 0 0.45 Q 0.4 0.28 0.75 0.42 T 1 0.35"
        fill="none"
        stroke="#e0c070"
        strokeWidth={0.032}
        opacity={0.6}
      />
    </TerrainPattern>
  )
}

function WallPattern() {
  const bricks = [
    [0.04, 0.06],
    [0.28, 0.06],
    [0.52, 0.06],
    [0.76, 0.06],
    [0.16, 0.28],
    [0.4, 0.28],
    [0.64, 0.28],
    [0.88, 0.28],
    [0.04, 0.5],
    [0.28, 0.5],
    [0.52, 0.5],
    [0.76, 0.5],
    [0.16, 0.72],
    [0.4, 0.72],
    [0.64, 0.72],
    [0.88, 0.72],
  ]
  return (
    <TerrainPattern id={terrainPatternId('wall')} base="#606470">
      {bricks.map(([bx, by], i) => (
        <rect
          key={i}
          x={bx}
          y={by}
          width={0.22}
          height={0.18}
          fill={i % 2 ? '#707480' : '#585c68'}
          stroke="#404448"
          strokeWidth={0.012}
        />
      ))}
    </TerrainPattern>
  )
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
        <rect width={1} height={1} fill="#281816" />
        <rect width={1} height={1} fill="#382820" opacity={0.35} />
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

/** Subtle drop shadow + top-edge highlight for hex depth. */
export function HexDepthFilter() {
  return (
    <filter
      id={HEX_DEPTH_FILTER_ID}
      x="-20%"
      y="-20%"
      width="140%"
      height="140%"
      colorInterpolationFilters="sRGB"
    >
      <feDropShadow dx="0" dy="0.18" stdDeviation="0.12" floodColor="#000" floodOpacity="0.35" />
      <feDropShadow dx="0" dy="-0.06" stdDeviation="0.04" floodColor="#fff" floodOpacity="0.06" />
    </filter>
  )
}

export function hexDepthFilterUrl(): string {
  return `url(#${HEX_DEPTH_FILTER_ID})`
}

/** All terrain SVG pattern defs — mount once per board SVG. */
export function TerrainPatternDefs() {
  return (
    <>
      <HexDepthFilter />
      <PlainsPattern />
      <ForestPattern />
      <HillsPattern />
      <SwampPattern />
      <WaterPattern />
      <DesertPattern />
      <WallPattern />
      <VolcanicMagmaPattern />
    </>
  )
}

/** @deprecated Use VolcanicMagmaPattern — kept for existing imports during transition. */
export const VolcanicMagmaGradient = VolcanicMagmaPattern
