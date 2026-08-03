import { boardMid } from './constants'
import {
  axialToOddR,
  hexDistOddR,
  hexKey,
  oddRToAxial,
  rotateAxial,
  type OddR,
} from './hex'
import type { ObjectiveMarker, SeatId } from './types'

/** Relative axial offsets from zone anchor (centroid hex at origin). */
export type ObjectiveShape = Array<{ q: number; r: number }>

/** Named multi-hex objective footprints (3–5 hexes, irregular/readable). */
export const OBJECTIVE_SHAPES: Record<string, ObjectiveShape> = {
  /** 3 hexes */
  triad3: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
  ],
  bend3: [
    { q: -1, r: 0 },
    { q: 0, r: 0 },
    { q: 1, r: -1 },
  ],
  cap3: [
    { q: -1, r: 0 },
    { q: 0, r: 0 },
    { q: 0, r: -1 },
  ],
  /** 4 hexes */
  barb4: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 1, r: -1 },
  ],
  zig4: [
    { q: 0, r: 0 },
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
  ],
  cluster4: [
    { q: -1, r: 0 },
    { q: 0, r: 0 },
    { q: 0, r: 1 },
    { q: 1, r: 0 },
  ],
  /** 5 hexes */
  hook5: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
  ],
  star5: [
    { q: 0, r: 0 },
    { q: -1, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: -1 },
    { q: 0, r: 1 },
  ],
  arc5: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 2, r: -1 },
    { q: 3, r: -1 },
  ],
}

/** Silhouette pools keyed by zone hex count (1 obj→5, 2→4, 3→3). */
export const OBJECTIVE_SHAPE_POOLS: Record<3 | 4 | 5, string[]> = {
  3: ['triad3', 'bend3', 'cap3'],
  4: ['barb4', 'zig4', 'cluster4'],
  5: ['hook5', 'star5', 'arc5'],
}

/** Hex count per zone given how many objectives the card places. */
export function objectiveZoneHexCount(objectiveCount: number): 3 | 4 | 5 {
  if (objectiveCount === 1) return 5
  if (objectiveCount === 2) return 4
  return 3
}

export type ObjectiveZoneDef = {
  /** Offset from board center for the zone anchor hex (shape centroid). */
  anchor: OddR
  /** Legacy size hint; placement randomizes among the matching pool. */
  shapeId: keyof typeof OBJECTIVE_SHAPES
}

export type ObjectiveCard = {
  id: string
  name: string
  zones: ObjectiveZoneDef[]
}

/**
 * Marker offsets stay outside edge-commander CR (printed max 7) but sit
 * closer to midfield for contested play.
 * On 31×31 N/S: |row| ≤ 4 → dist ≥ 11 from edge. On 35×35 W/E: |col| ≤ 5 → dist ≥ 12.
 */
export const OBJECTIVE_DECK: ObjectiveCard[] = [
  {
    id: 'single-center',
    name: 'Single Center',
    zones: [{ anchor: { col: 0, row: 0 }, shapeId: 'hook5' }],
  },
  {
    id: 'mirror-ns',
    name: 'North–South Pair',
    zones: [
      { anchor: { col: 0, row: -4 }, shapeId: 'barb4' },
      { anchor: { col: 0, row: 4 }, shapeId: 'barb4' },
    ],
  },
  {
    id: 'mirror-we',
    name: 'West–East Pair',
    zones: [
      { anchor: { col: -4, row: 0 }, shapeId: 'barb4' },
      { anchor: { col: 4, row: 0 }, shapeId: 'barb4' },
    ],
  },
  {
    id: 'triangle',
    name: 'Triad',
    zones: [
      { anchor: { col: 0, row: 0 }, shapeId: 'triad3' },
      { anchor: { col: -5, row: -4 }, shapeId: 'triad3' },
      { anchor: { col: 5, row: 4 }, shapeId: 'triad3' },
    ],
  },
  {
    id: 'wide-three',
    name: 'Wide Three',
    zones: [
      { anchor: { col: -5, row: 0 }, shapeId: 'triad3' },
      { anchor: { col: 0, row: 0 }, shapeId: 'triad3' },
      { anchor: { col: 5, row: 0 }, shapeId: 'triad3' },
    ],
  },
  {
    id: 'diagonal-pair',
    name: 'Diagonal Pair',
    zones: [
      { anchor: { col: -4, row: -4 }, shapeId: 'barb4' },
      { anchor: { col: 4, row: 4 }, shapeId: 'barb4' },
    ],
  },
]

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexDistAxial(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2
}

/** Medoid hex — minimizes total distance to every cell in the footprint. */
export function objectiveShapeCentroid(shape: ObjectiveShape): { q: number; r: number } {
  let best = shape[0]!
  let bestSum = Infinity
  for (const candidate of shape) {
    let sum = 0
    for (const other of shape) {
      sum += hexDistAxial(candidate, other)
    }
    if (sum < bestSum) {
      bestSum = sum
      best = candidate
    }
  }
  return best
}

/** Shift shape so its medoid sits at axial origin (★ anchor hex). */
export function centerObjectiveShape(shape: ObjectiveShape): ObjectiveShape {
  const c = objectiveShapeCentroid(shape)
  return shape.map(({ q, r }) => ({ q: q - c.q, r: r - c.r }))
}

const CENTERED_OBJECTIVE_SHAPES: Record<string, ObjectiveShape> = Object.fromEntries(
  Object.entries(OBJECTIVE_SHAPES).map(([id, shape]) => [id, centerObjectiveShape(shape)]),
)

/** Mirror across the axial q-axis (cube x-axis reflection). */
export function reflectAxial(q: number, r: number): { q: number; r: number } {
  return { q, r: -r - q }
}

export type ZonePlacement = {
  shapeId: string
  rotation: number
  reflect: boolean
}

/** Deterministic per-zone silhouette + orientation from room seed. */
export function rollZonePlacement(
  roomCode: string,
  cardId: string,
  zoneIndex: number,
  hexCount: 3 | 4 | 5,
): ZonePlacement {
  const rng = mulberry32(hashString(`${roomCode}:obj:${cardId}:${zoneIndex}`))
  const pool = OBJECTIVE_SHAPE_POOLS[hexCount]
  const shapeId = pool[Math.floor(rng() * pool.length)]!
  const rotation = Math.floor(rng() * 6)
  const reflect = rng() < 0.5
  return { shapeId, rotation, reflect }
}

export function objectiveCardDrawRng(roomCode: string): () => number {
  return mulberry32(hashString(`${roomCode}:obj-card`))
}

/** Hexes covered when placing a centered shape at `anchor` with rotation/reflection. */
export function expandObjectiveShape(
  anchor: OddR,
  shape: ObjectiveShape,
  rotation: number,
  reflect: boolean,
): OddR[] {
  const origin = oddRToAxial(anchor.col, anchor.row)
  const rot = ((rotation % 6) + 6) % 6
  return shape.map(({ q, r }) => {
    let tq = q
    let tr = r
    if (reflect) {
      const mirrored = reflectAxial(tq, tr)
      tq = mirrored.q
      tr = mirrored.r
    }
    const rotated = rotateAxial(tq, tr, rot)
    return axialToOddR(origin.q + rotated.q, origin.r + rotated.r)
  })
}

/** Absolute odd-r hexes for a shape anchored at `anchor` (no rotation). */
export function objectiveShapeHexes(anchor: OddR, shape: ObjectiveShape): OddR[] {
  return expandObjectiveShape(anchor, shape, 0, false)
}

export type ObjectiveZoneOnBoard = {
  anchor: OddR
  hexes: OddR[]
  shapeId: string
  rotation: number
  reflect: boolean
}

/** Absolute zones (centroid anchor + all hexes) for a card on a given board size. */
export function objectiveZonesOnBoard(
  card: ObjectiveCard,
  boardSize: number,
  roomCode: string,
): ObjectiveZoneOnBoard[] {
  const mid = boardMid(boardSize)
  const hexCount = objectiveZoneHexCount(card.zones.length)
  return card.zones.map((zone, i) => {
    const anchor = { col: mid + zone.anchor.col, row: mid + zone.anchor.row }
    const placement = rollZonePlacement(roomCode, card.id, i, hexCount)
    const shape =
      CENTERED_OBJECTIVE_SHAPES[placement.shapeId] ?? CENTERED_OBJECTIVE_SHAPES.triad3!
    return {
      anchor,
      hexes: expandObjectiveShape(anchor, shape, placement.rotation, placement.reflect),
      shapeId: placement.shapeId,
      rotation: placement.rotation,
      reflect: placement.reflect,
    }
  })
}

/** Flat list of every objective hex on the board (connectivity / terrain checks). */
export function objectiveMarkersOnBoard(
  card: ObjectiveCard,
  boardSize: number,
  roomCode: string,
): OddR[] {
  const seen = new Set<string>()
  const hexes: OddR[] = []
  for (const zone of objectiveZonesOnBoard(card, boardSize, roomCode)) {
    for (const h of zone.hexes) {
      const k = hexKey(h.col, h.row)
      if (seen.has(k)) continue
      seen.add(k)
      hexes.push(h)
    }
  }
  return hexes
}

/** All hexes in a placed objective zone (backward-compat: single-hex if `hexes` missing). */
export function objectiveZoneHexes(
  marker: Pick<ObjectiveMarker, 'col' | 'row' | 'hexes'>,
): OddR[] {
  if (marker.hexes?.length) return marker.hexes
  return [{ col: marker.col, row: marker.row }]
}

/** Every hex across all objective zones on the board. */
export function flattenObjectiveHexes(
  markers: Array<Pick<ObjectiveMarker, 'col' | 'row' | 'hexes'>>,
): OddR[] {
  const seen = new Set<string>()
  const out: OddR[] = []
  for (const m of markers) {
    for (const h of objectiveZoneHexes(m)) {
      const k = hexKey(h.col, h.row)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(h)
    }
  }
  return out
}

export function objectiveHexKeySet(
  markers: Array<Pick<ObjectiveMarker, 'col' | 'row' | 'hexes'>>,
): Set<string> {
  return new Set(flattenObjectiveHexes(markers).map((h) => hexKey(h.col, h.row)))
}

/** True if any objective hex sits inside any seated commander's Command Radius. */
export function objectiveMarkersInCommandRadius(
  markers: OddR[],
  commanders: Partial<Record<SeatId, OddR | null | undefined>>,
  radii: Partial<Record<SeatId, number>>,
): boolean {
  for (const marker of markers) {
    for (const seat of Object.keys(commanders) as SeatId[]) {
      const origin = commanders[seat]
      if (!origin) continue
      const radius = radii[seat] ?? 5
      if (hexDistOddR(origin, marker) <= radius) return true
    }
  }
  return false
}

export function objectiveCardClearOfCommandRadii(
  card: ObjectiveCard,
  boardSize: number,
  commanders: Partial<Record<SeatId, OddR | null | undefined>>,
  radii: Partial<Record<SeatId, number>>,
  roomCode: string,
): boolean {
  const markers = objectiveMarkersOnBoard(card, boardSize, roomCode)
  return !objectiveMarkersInCommandRadius(markers, commanders, radii)
}

export function drawObjectiveCard(rng: () => number = Math.random): ObjectiveCard {
  const i = Math.floor(rng() * OBJECTIVE_DECK.length)
  return OBJECTIVE_DECK[i]!
}

/**
 * Draw an objective card whose zones start outside every commander's CR.
 * Falls back to Single Center if the filtered deck is empty.
 */
export function drawObjectiveCardOutsideCommandRadii(
  boardSize: number,
  commanders: Partial<Record<SeatId, OddR | null | undefined>>,
  radii: Partial<Record<SeatId, number>>,
  roomCode: string,
): ObjectiveCard {
  const rng = objectiveCardDrawRng(roomCode)
  const valid = OBJECTIVE_DECK.filter((card) =>
    objectiveCardClearOfCommandRadii(card, boardSize, commanders, radii, roomCode),
  )
  if (valid.length > 0) {
    return valid[Math.floor(rng() * valid.length)]!
  }
  const center = OBJECTIVE_DECK.find((c) => c.id === 'single-center')
  if (
    center &&
    objectiveCardClearOfCommandRadii(center, boardSize, commanders, radii, roomCode)
  ) {
    return center
  }
  return {
    id: 'single-center-forced',
    name: 'Single Center',
    zones: [{ anchor: { col: 0, row: 0 }, shapeId: 'hook5' }],
  }
}
