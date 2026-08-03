/** Multi-hex terrain pieces for setup placement (with rotation). */

import {
  axialToOddR,
  hexKey,
  inBounds,
  neighborsOddR,
  oddRToAxial,
  rotateAxial,
  type OddR,
} from './hex'

/**
 * Soft water cap: new water pieces may only be started while current water hexes
 * are below this. A piece may push the total over the cap.
 */
export const WATER_HEX_CAP = 50

export type TerrainKind =
  | 'plains'
  | 'forest'
  | 'swamp'
  | 'desert'
  | 'water'
  | 'wall'
  | 'volcanic'
  | 'hills'

/** Setup draw tier — large land first, then gap-fill / barriers. */
export type TerrainSizeClass = 'large' | 'medium' | 'small'

/** Personal CR piece quotas when not flood-filling. */
export type CommandZonePieceQuota = {
  large: number
  medium: number
  small: number
}

export function commandZonePieceQuota(maxPlayers: 2 | 4): CommandZonePieceQuota {
  return maxPlayers === 2
    ? { large: 1, medium: 2, small: 2 }
    : { large: 0, medium: 1, small: 2 }
}

export function commandZoneSlotsTotal(maxPlayers: 2 | 4): number {
  const q = commandZonePieceQuota(maxPlayers)
  return q.large + q.medium + q.small
}

export type TerrainPieceDef = {
  id: string
  name: string
  kind: TerrainKind
  sizeClass: TerrainSizeClass
  /** Relative axial offsets; (0,0) is the placement anchor. */
  shape: Array<{ q: number; r: number }>
}

/** All axial cells within cube distance `radius` of the origin. R=3 → 37 hexes. */
export function axialDisk(radius: number): Array<{ q: number; r: number }> {
  const cells: Array<{ q: number; r: number }> = []
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius)
    const rMax = Math.min(radius, -q + radius)
    for (let r = rMin; r <= rMax; r++) cells.push({ q, r })
  }
  return cells
}

/** Solid ribbon along +q: `length` × (2×halfWidth+1). */
export function axialRibbon(
  length: number,
  halfWidth: number,
): Array<{ q: number; r: number }> {
  const cells: Array<{ q: number; r: number }> = []
  for (let q = 0; q < length; q++) {
    for (let r = -halfWidth; r <= halfWidth; r++) {
      cells.push({ q, r })
    }
  }
  return cells
}

function unionAxial(
  ...shapes: Array<Array<{ q: number; r: number }>>
): Array<{ q: number; r: number }> {
  const map = new Map<string, { q: number; r: number }>()
  for (const shape of shapes) {
    for (const c of shape) map.set(`${c.q},${c.r}`, c)
  }
  return [...map.values()]
}

function shiftAxial(
  shape: Array<{ q: number; r: number }>,
  dq: number,
  dr: number,
): Array<{ q: number; r: number }> {
  return shape.map((c) => ({ q: c.q + dq, r: c.r + dr }))
}

const AXIAL_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canonicalShapeKey(shape: Array<{ q: number; r: number }>): string {
  return [...shape]
    .sort((a, b) => a.q - b.q || a.r - b.r)
    .map((c) => `${c.q},${c.r}`)
    .join('|')
}

function isMirrorSymmetric(shape: Array<{ q: number; r: number }>): boolean {
  if (shape.length <= 1) return false
  const set = new Set(shape.map((c) => `${c.q},${c.r}`))
  if (shape.every((c) => set.has(`${-c.q},${c.r}`))) return true
  if (shape.every((c) => set.has(`${c.q},${-c.r}`))) return true
  return false
}

function cubeDistance(q: number, r: number): number {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))
}

/** Reject near-solid disks (giant hex / lightly notched blobs). */
function isNearRegularDisk(shape: Array<{ q: number; r: number }>): boolean {
  if (shape.length < 18) return false
  let maxDist = 0
  for (const c of shape) {
    maxDist = Math.max(maxDist, cubeDistance(c.q, c.r))
  }
  if (maxDist < 2) return false
  const diskSize = axialDisk(maxDist).length
  return shape.length / diskSize >= 0.82
}

function generatePolyomino(
  minSize: number,
  maxSize: number,
  rng: () => number,
): Array<{ q: number; r: number }> {
  const target = minSize + Math.floor(rng() * (maxSize - minSize + 1))
  const cells = new Map<string, { q: number; r: number }>()
  cells.set('0,0', { q: 0, r: 0 })
  let guard = 0
  while (cells.size < target && guard < target * 50) {
    guard++
    const list = [...cells.values()]
    const pick = list[Math.floor(rng() * list.length)]!
    const dir = AXIAL_DIRS[Math.floor(rng() * AXIAL_DIRS.length)]!
    const next = { q: pick.q + dir.q, r: pick.r + dir.r }
    cells.set(`${next.q},${next.r}`, next)
  }
  return [...cells.values()]
}

function buildAsymmetricShapePool(
  handcrafted: Array<{
    key: string
    title: string
    shape: Array<{ q: number; r: number }>
  }>,
  minSize: number,
  maxSize: number,
  generatedCount: number,
  seedBase: number,
): Array<{ key: string; title: string; shape: Array<{ q: number; r: number }> }> {
  const pool = [...handcrafted]
  const seen = new Set(pool.map((s) => canonicalShapeKey(s.shape)))
  let seed = seedBase
  while (pool.length < handcrafted.length + generatedCount && seed < seedBase + 800) {
    seed++
    const shape = generatePolyomino(minSize, maxSize, mulberry32(seed))
    if (shape.length < minSize) continue
    if (isMirrorSymmetric(shape)) continue
    if (isNearRegularDisk(shape)) continue
    const k = canonicalShapeKey(shape)
    if (seen.has(k)) continue
    seen.add(k)
    const idx = pool.length - handcrafted.length + 1
    pool.push({
      key: `link-${String(idx).padStart(2, '0')}`,
      title: `Linked ${shape.length}`,
      shape,
    })
  }
  return pool
}

export type TerrainShapeSilhouette = {
  key: string
  title: string
  sizeClass: 'large' | 'medium'
  shape: Array<{ q: number; r: number }>
}

// —— Asymmetric silhouette library (large ≈ 22–37 hex, medium ≈ 5–12) ——

const DISK_R2 = axialDisk(2) // 19

/** Irregular blob with peninsulas. */
const SHAPE_PENINSULA = unionAxial(
  DISK_R2,
  [
    { q: 3, r: 0 },
    { q: 4, r: 0 },
    { q: 3, r: -1 },
    { q: -2, r: 2 },
    { q: -3, r: 2 },
    { q: -2, r: 3 },
    { q: 0, r: -3 },
    { q: 1, r: -3 },
    { q: 0, r: 3 },
    { q: -1, r: 3 },
  ],
)

/** S-curve / serpent. */
const SHAPE_SNAKE = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 3, r: 0 },
  { q: 3, r: 1 },
  { q: 3, r: 2 },
  { q: 4, r: 2 },
  { q: 5, r: 2 },
  { q: 6, r: 2 },
  { q: 6, r: 1 },
  { q: 6, r: 0 },
  { q: 7, r: 0 },
  { q: 8, r: 0 },
  { q: 8, r: -1 },
  { q: 8, r: -2 },
  { q: 9, r: -2 },
  { q: 10, r: -2 },
  { q: 2, r: 1 },
  { q: 4, r: 1 },
  { q: 5, r: 1 },
  { q: 7, r: -1 },
  { q: 9, r: -1 },
  { q: 1, r: 1 },
  { q: 4, r: 0 },
  { q: 5, r: 0 },
]

/** Broad wedge. */
const SHAPE_WEDGE = unionAxial(
  DISK_R2,
  [
    { q: 3, r: 0 },
    { q: 4, r: 0 },
    { q: 5, r: 0 },
    { q: 3, r: 1 },
    { q: 4, r: 1 },
    { q: 3, r: -1 },
    { q: 4, r: -1 },
    { q: 2, r: 2 },
    { q: 3, r: 2 },
    { q: 2, r: -2 },
    { q: 3, r: -2 },
    { q: 6, r: 0 },
    { q: 5, r: 1 },
    { q: 5, r: -1 },
  ],
)

/** Spurred mass — disk with offset arm. */
const SHAPE_SPUR = unionAxial(
  DISK_R2,
  axialRibbon(7, 0).map((c) => ({ q: c.q + 2, r: c.r })),
  [
    { q: 0, r: 3 },
    { q: 0, r: 4 },
    { q: 0, r: 5 },
    { q: 1, r: 3 },
    { q: -1, r: 4 },
    { q: 1, r: 4 },
  ],
)

/** Thick Y — chunky junction with three wide arms (not a thin spur). */
const SHAPE_FORK = unionAxial(
  axialRibbon(6, 1),
  [
    { q: -1, r: -1 },
    { q: -1, r: 0 },
    { q: -2, r: -1 },
    { q: -2, r: -2 },
    { q: -2, r: 0 },
    { q: -3, r: -2 },
    { q: -3, r: -3 },
    { q: -3, r: -1 },
    { q: -4, r: -3 },
    { q: -4, r: -4 },
    { q: -4, r: -2 },
    { q: -5, r: -4 },
    { q: -5, r: -5 },
  ],
  [
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: -2, r: 1 },
    { q: -2, r: 2 },
    { q: -2, r: 0 },
    { q: -3, r: 1 },
    { q: -3, r: 2 },
    { q: -3, r: 3 },
    { q: -4, r: 2 },
    { q: -4, r: 3 },
    { q: -4, r: 4 },
    { q: -5, r: 3 },
    { q: -5, r: 4 },
  ],
)

/** Jagged coast / irregular blob. */
const SHAPE_JAGGED = unionAxial(
  DISK_R2,
  [
    { q: 3, r: -1 },
    { q: 4, r: -1 },
    { q: 4, r: 0 },
    { q: 5, r: 0 },
    { q: 5, r: 1 },
    { q: 4, r: 2 },
    { q: 3, r: 2 },
    { q: 2, r: 3 },
    { q: 1, r: 3 },
    { q: -2, r: 3 },
    { q: -3, r: 2 },
    { q: -3, r: 1 },
    { q: -4, r: 0 },
    { q: -3, r: -1 },
    { q: -2, r: -2 },
    { q: 0, r: -3 },
    { q: 1, r: -3 },
    { q: 2, r: -3 },
  ],
)

const SHAPE_M_THICKET = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: 1 },
  { q: -1, r: 1 },
]
const SHAPE_M_ARC = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 2, r: -1 },
  { q: 1, r: -1 },
  { q: 0, r: 1 },
]
const SHAPE_M_HOOK = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 3, r: 0 },
  { q: 3, r: -1 },
  { q: 3, r: -2 },
  { q: 2, r: -1 },
]
const SHAPE_M_BLOB = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: 1 },
  { q: 1, r: -1 },
  { q: 2, r: -1 },
  { q: -1, r: 0 },
]
const SHAPE_M_SNAKE = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 2, r: 1 },
  { q: 3, r: 1 },
  { q: 4, r: 1 },
]
const SHAPE_M_FAN = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: 1 },
  { q: 0, r: 2 },
]

const HANDCRAFTED_LARGE = [
  { key: 'peninsula', title: 'Peninsula', shape: SHAPE_PENINSULA },
  { key: 'snake', title: 'Serpent', shape: SHAPE_SNAKE },
  { key: 'wedge', title: 'Wedge', shape: SHAPE_WEDGE },
  { key: 'spur', title: 'Spur', shape: SHAPE_SPUR },
  { key: 'fork', title: 'Fork', shape: SHAPE_FORK },
  { key: 'jagged', title: 'Jagged', shape: SHAPE_JAGGED },
]

const HANDCRAFTED_MEDIUM = [
  { key: 'thicket', title: 'Thicket', shape: SHAPE_M_THICKET },
  { key: 'arc', title: 'Arc', shape: SHAPE_M_ARC },
  { key: 'hook', title: 'Hook', shape: SHAPE_M_HOOK },
  { key: 'blob', title: 'Blob', shape: SHAPE_M_BLOB },
  { key: 'bend', title: 'Bend', shape: SHAPE_M_SNAKE },
  { key: 'fan', title: 'Fan', shape: SHAPE_M_FAN },
]

/** Large/medium silhouettes: handcrafted irregular + randomly linked polyominoes. */
const LARGE_SILHOUETTES = buildAsymmetricShapePool(
  HANDCRAFTED_LARGE,
  22,
  35,
  10,
  0x4c41_0001,
)

const MEDIUM_SILHOUETTES = buildAsymmetricShapePool(
  HANDCRAFTED_MEDIUM,
  5,
  11,
  10,
  0x4c41_0101,
)

function piece(
  id: string,
  name: string,
  kind: TerrainKind,
  sizeClass: TerrainSizeClass,
  shape: Array<{ q: number; r: number }>,
): TerrainPieceDef {
  return { id, name, kind, sizeClass, shape }
}

const TERRAIN_TYPE_META: Array<{ kind: TerrainKind; label: string }> = [
  { kind: 'plains', label: 'Plains' },
  { kind: 'forest', label: 'Forest' },
  { kind: 'swamp', label: 'Swamp' },
  { kind: 'desert', label: 'Desert' },
  { kind: 'volcanic', label: 'Volcanic' },
  { kind: 'hills', label: 'Hills' },
  { kind: 'water', label: 'Water' },
]

/**
 * Full type×silhouette catalog for large & medium land (all land kinds incl. water).
 * Command-zone piece picks still restrict water to small via kindsForShapeSize + server validation.
 */
export const TYPED_TERRAIN_PIECES: TerrainPieceDef[] = TERRAIN_TYPE_META.flatMap(({ kind, label }) => [
  ...LARGE_SILHOUETTES.map((s) =>
    piece(`${kind}-${s.key}`, `${label} ${s.title}`, kind, 'large', s.shape),
  ),
  ...MEDIUM_SILHOUETTES.map((s) =>
    piece(`${kind}-${s.key}`, `${label} ${s.title}`, kind, 'medium', s.shape),
  ),
])

/** Small gap-fill / barriers (and walls for command zone). */
export const SMALL_TERRAIN_PIECES: TerrainPieceDef[] = [
  piece('plains-pair', 'Plains Pair', 'plains', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]),
  piece('plains-dot', 'Clearing', 'plains', 'small', [{ q: 0, r: 0 }]),
  piece('forest-pair', 'Forest Pair', 'forest', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]),
  piece('forest-dot', 'Lone Copse', 'forest', 'small', [{ q: 0, r: 0 }]),
  piece('forest-elbow-s', 'Forest Elbow', 'forest', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
  ]),
  piece('swamp-pair', 'Swamp Pair', 'swamp', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]),
  piece('swamp-dot', 'Bog Patch', 'swamp', 'small', [{ q: 0, r: 0 }]),
  piece('swamp-elbow-s', 'Swamp Elbow', 'swamp', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
  ]),
  piece('desert-pair', 'Dune Pair', 'desert', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]),
  piece('desert-dot', 'Lone Dune', 'desert', 'small', [{ q: 0, r: 0 }]),
  piece('desert-elbow-s', 'Desert Elbow', 'desert', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
  ]),
  piece('water-pair', 'Water Pair', 'water', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]),
  piece('water-dot', 'Puddle', 'water', 'small', [{ q: 0, r: 0 }]),
  piece('wall-corner', 'Wall Corner', 'wall', 'medium', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
  ]),
  piece('wall-segment', 'Wall Segment', 'wall', 'small', [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]),
]

/** @deprecated alias — plains always first in command-zone catalog. */
export const PLAINS_COMMAND_ZONE_PIECES: TerrainPieceDef[] =
  TYPED_TERRAIN_PIECES.filter((p) => p.kind === 'plains' && p.sizeClass === 'medium')

/** Full piece pool used by land drops + command zone (excl. walls-only extras). */
export const TERRAIN_PIECE_DECK: TerrainPieceDef[] = [
  ...TYPED_TERRAIN_PIECES,
  ...SMALL_TERRAIN_PIECES.filter((p) => p.kind !== 'wall'),
  ...SMALL_TERRAIN_PIECES.filter((p) => p.kind === 'wall'),
]

/** Extra land pieces kept for compatibility with older imports. */
export const EXTRA_LAND_PIECES: TerrainPieceDef[] = []

/** Land kinds for post-CR land drops (includes water; no walls). */
export const LAND_TERRAIN_KINDS: TerrainKind[] = [
  'plains',
  'forest',
  'swamp',
  'desert',
  'volcanic',
  'hills',
  'water',
]

export function isLandTerrainKind(kind: TerrainKind): boolean {
  return (LAND_TERRAIN_KINDS as string[]).includes(kind)
}

/** Soft ground that may sit under a commander (not Water/Wall). */
export function terrainMayCoverCommander(kind: TerrainKind): boolean {
  return (
    kind === 'plains' ||
    kind === 'forest' ||
    kind === 'desert' ||
    kind === 'swamp' ||
    kind === 'volcanic' ||
    kind === 'hills'
  )
}

/** Catalog for command-zone piece picks (includes large when quota allows). */
export function commandZonePieceCatalog(maxPlayers: 2 | 4): TerrainPieceDef[] {
  const quota = commandZonePieceQuota(maxPlayers)
  const typed = TYPED_TERRAIN_PIECES.filter((p) => {
    if (p.sizeClass === 'large' && quota.large === 0) return false
    if (p.sizeClass === 'medium' && quota.medium === 0) return false
    return true
  })
  const extras = SMALL_TERRAIN_PIECES.filter(
    (p) =>
      p.sizeClass === 'small' ||
      (p.sizeClass === 'medium' && quota.medium > 0),
  )
  const seen = new Set(typed.map((p) => p.id))
  return [
    ...typed.filter((p) => p.kind === 'plains' && p.sizeClass !== 'large'),
    ...typed.filter((p) => p.kind !== 'plains' && p.sizeClass !== 'large'),
    ...(quota.large > 0
      ? typed.filter((p) => p.sizeClass === 'large' && p.kind === 'plains')
      : []),
    ...(quota.large > 0
      ? typed.filter((p) => p.sizeClass === 'large' && p.kind !== 'plains')
      : []),
    ...extras.filter((p) => !seen.has(p.id)),
  ]
}

/** Kinds allowed when flood-filling a command radius. */
export const FLOOD_TERRAIN_KINDS: TerrainKind[] = [
  'plains',
  'forest',
  'swamp',
  'desert',
  'volcanic',
  'hills',
  'water',
]

/** @deprecated — use commandZonePieceCatalog */
export const COMMAND_ZONE_TERRAIN_DECK: TerrainPieceDef[] =
  commandZonePieceCatalog(2)

/** Full land catalog for choose-your-own large / medium / small drops. */
export const LAND_TERRAIN_DECK: TerrainPieceDef[] = [
  ...TYPED_TERRAIN_PIECES,
  ...SMALL_TERRAIN_PIECES.filter((p) => isLandTerrainKind(p.kind)),
]

/** Prefer compact silhouettes first so the default land pick is easier to place. */
export function landPiecesForSize(size: TerrainSizeClass): TerrainPieceDef[] {
  return LAND_TERRAIN_DECK.filter((p) => p.sizeClass === size).sort(
    (a, b) => a.shape.length - b.shape.length || a.name.localeCompare(b.name),
  )
}

/** Kind-agnostic silhouettes for shape-first UI (large / medium only). */
export function terrainShapeSilhouettes(
  sizeClass: 'large' | 'medium',
): TerrainShapeSilhouette[] {
  const list =
    sizeClass === 'large' ? LARGE_SILHOUETTES : MEDIUM_SILHOUETTES
  return list.map((s) => ({ ...s, sizeClass }))
}

/** Build a full piece def from shape key + terrain kind. */
export function buildTerrainPiece(
  shapeKey: string,
  kind: TerrainKind,
  sizeClass: TerrainSizeClass,
): TerrainPieceDef | null {
  if (sizeClass === 'small') {
    return (
      SMALL_TERRAIN_PIECES.find(
        (p) => p.id === `${kind}-${shapeKey}` || p.id === shapeKey,
      ) ?? null
    )
  }
  const sil =
    sizeClass === 'large'
      ? LARGE_SILHOUETTES.find((s) => s.key === shapeKey)
      : MEDIUM_SILHOUETTES.find((s) => s.key === shapeKey)
  if (!sil) return null
  const label =
    TERRAIN_TYPE_META.find((m) => m.kind === kind)?.label ?? kind
  return piece(
    `${kind}-${sil.key}`,
    `${label} ${sil.title}`,
    kind,
    sizeClass,
    sil.shape,
  )
}

const ALL_LAND_KINDS: TerrainKind[] = [
  'plains',
  'forest',
  'swamp',
  'desert',
  'volcanic',
  'hills',
  'water',
]

/** Kinds available when pairing with a shape in the type step. */
export function kindsForShapeSize(
  sizeClass: TerrainSizeClass,
  opts?: { battlefield?: boolean },
): TerrainKind[] {
  if (opts?.battlefield || sizeClass === 'small') {
    return ALL_LAND_KINDS
  }
  // Command zone: water is small-only.
  return TERRAIN_TYPE_META.filter((m) => m.kind !== 'water').map((m) => m.kind)
}

/** Small pre-built pieces (simple pairs/dots — no shape×type grid). */
export function smallTerrainPieceCatalog(): TerrainPieceDef[] {
  return SMALL_TERRAIN_PIECES.filter((p) => p.sizeClass === 'small')
}

const SIZE_RANK: Record<TerrainSizeClass, number> = {
  large: 0,
  medium: 1,
  small: 2,
}

export type TerrainQueueItem = {
  instanceId: string
  pieceId: string
  name: string
  kind: TerrainKind
  sizeClass: TerrainSizeClass
  shape: Array<{ q: number; r: number }>
  placed: boolean
  /** Command-zone slot consumed without placing (counts toward picks). */
  skipped?: boolean
  /** Entire CR flood-filled with one terrain kind. */
  flooded?: boolean
}

function pickFromPool(
  pool: TerrainPieceDef[],
  count: number,
  rng: () => number,
): TerrainPieceDef[] {
  const remaining = [...pool]
  const picked: TerrainPieceDef[] = []
  for (let i = 0; i < count && remaining.length; i++) {
    const idx = Math.floor(rng() * remaining.length)
    picked.push(remaining.splice(idx, 1)[0]!)
  }
  return picked
}

/**
 * Draw a shared terrain queue: guaranteed large features first, then fillers.
 * Default: 3 large + 2 medium/small.
 */
export function drawTerrainPieces(
  count = 5,
  rng: () => number = Math.random,
  opts: { largeCount?: number } = {},
): TerrainQueueItem[] {
  const largeWanted = Math.min(
    opts.largeCount ?? Math.min(3, count),
    count,
    TERRAIN_PIECE_DECK.filter((p) => p.sizeClass === 'large').length,
  )
  const largePool = TERRAIN_PIECE_DECK.filter((p) => p.sizeClass === 'large')
  const fillerPool = TERRAIN_PIECE_DECK.filter((p) => p.sizeClass !== 'large')

  const large = pickFromPool(largePool, largeWanted, rng)
  const fillers = pickFromPool(fillerPool, count - large.length, rng)
  const picked = [...large, ...fillers]

  picked.sort(
    (a, b) =>
      SIZE_RANK[a.sizeClass] - SIZE_RANK[b.sizeClass] ||
      b.shape.length - a.shape.length ||
      a.name.localeCompare(b.name),
  )

  return picked.map((def, i) => ({
    instanceId: `${def.id}-${i}`,
    pieceId: def.id,
    name: def.name,
    kind: def.kind,
    sizeClass: def.sizeClass,
    shape: def.shape.map((c) => ({ ...c })),
    placed: false,
  }))
}

/** Hexes covered when placing `shape` at `anchor` with `rotation` (0–5 × 60° CW). */
export function expandTerrainPiece(
  anchor: OddR,
  shape: Array<{ q: number; r: number }>,
  rotation: number,
): OddR[] {
  const origin = oddRToAxial(anchor.col, anchor.row)
  return shape.map((offset) => {
    const rotated = rotateAxial(offset.q, offset.r, rotation)
    return axialToOddR(origin.q + rotated.q, origin.r + rotated.r)
  })
}

export function normalizeRotation(rotation: number): number {
  return ((rotation % 6) + 6) % 6
}

export type TerrainMap = Record<string, TerrainKind>

export function terrainAt(map: TerrainMap, col: number, row: number): TerrainKind {
  return map[hexKey(col, row)] ?? 'plains'
}

/**
 * Get terrain at a hex for gameplay (movement/combat) purposes.
 * Objective hexes are always neutral land (plains) regardless of placed terrain.
 * This allows terrain to visually overlap objectives while keeping objectives passable.
 */
export function terrainAtForGameplay(
  map: TerrainMap,
  col: number,
  row: number,
  objectiveKeys?: Set<string>,
): TerrainKind {
  const key = hexKey(col, row)
  if (objectiveKeys?.has(key)) return 'plains'
  return map[key] ?? 'plains'
}

/** Write explicit plains onto every hex that has no terrain yet. */
export function fillEmptyHexesWithPlains(
  terrain: TerrainMap,
  boardSize: number,
): TerrainMap {
  const next = { ...terrain }
  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      const key = hexKey(col, row)
      if (!next[key]) next[key] = 'plains'
    }
  }
  return next
}

export function countWaterHexes(terrain: TerrainMap): number {
  let n = 0
  for (const kind of Object.values(terrain)) {
    if (kind === 'water') n++
  }
  return n
}

/** True while board water is still under the soft cap (piece may overshoot). */
export function waterPlacementAllowed(
  terrain: TerrainMap,
  cap = WATER_HEX_CAP,
): boolean {
  return countWaterHexes(terrain) < cap
}

export function validateTerrainPlacement(
  cells: OddR[],
  opts: {
    boardSize: number
    terrain: TerrainMap
    objectives: OddR[]
    kind: TerrainKind
    /** Hex keys that must NOT be covered. */
    blockedKeys?: Set<string>
    /** If set, every cell must lie in this set (e.g. own Command Radius). */
    requiredKeys?: Set<string>
    /** Soft water cap; defaults to WATER_HEX_CAP. */
    waterHexCap?: number
    /**
     * Allow small land pieces to overwrite water hexes (land bridge).
     */
    allowOverwriteWater?: boolean
  },
): { ok: true } | { ok: false; error: string } {
  const waterCap = opts.waterHexCap ?? WATER_HEX_CAP
  if (opts.kind === 'water' && !waterPlacementAllowed(opts.terrain, waterCap)) {
    return {
      ok: false,
      error: `Water cap reached (${countWaterHexes(opts.terrain)}/${waterCap} hexes). No new water pieces.`,
    }
  }
  const objKeys = new Set(opts.objectives.map((o) => hexKey(o.col, o.row)))
  const blocked = opts.blockedKeys ?? new Set<string>()
  const required = opts.requiredKeys
  const seen = new Set<string>()
  for (const cell of cells) {
    if (!inBounds(cell, opts.boardSize)) {
      return { ok: false, error: 'Piece goes off the board.' }
    }
    const key = hexKey(cell.col, cell.row)
    if (seen.has(key)) continue
    seen.add(key)
    const existingTerrain = opts.terrain[key]
    if (existingTerrain) {
      if (existingTerrain === opts.kind) {
        // Same kind may overlap (e.g. large piece over flooded CR plains).
      } else if (
        opts.allowOverwriteWater &&
        existingTerrain === 'water' &&
        opts.kind !== 'water' &&
        opts.kind !== 'wall'
      ) {
        // Small land bridges water
      } else {
        return { ok: false, error: 'Overlaps different terrain.' }
      }
    }
    if (blocked.has(key)) {
      return {
        ok: false,
        error: 'Cannot place on a blocked hex.',
      }
    }
    if (required && !required.has(key)) {
      return {
        ok: false,
        error: 'Must place entirely inside your Command Radius.',
      }
    }
    if (objKeys.has(key)) {
      return { ok: false, error: 'Cannot place on an objective.' }
    }
  }
  return { ok: true }
}

export function isImpassableTerrain(kind: TerrainKind | undefined): boolean {
  return kind === 'water' || kind === 'wall'
}

/** All passable hexes reachable from `origin` (4/6-neighbor BFS). */
export function passableReachableFrom(
  origin: OddR,
  terrain: TerrainMap,
  boardSize: number,
): Set<string> {
  const startKey = hexKey(origin.col, origin.row)
  const reachable = new Set<string>()
  if (isImpassableTerrain(terrain[startKey])) return reachable

  const queue: OddR[] = [origin]
  reachable.add(startKey)

  while (queue.length) {
    const cur = queue.shift()!
    for (const n of neighborsOddR(cur)) {
      if (!inBounds(n, boardSize)) continue
      const nk = hexKey(n.col, n.row)
      if (reachable.has(nk)) continue
      if (isImpassableTerrain(terrain[nk])) continue
      reachable.add(nk)
      queue.push(n)
    }
  }
  return reachable
}

/**
 * Every commander and objective must lie in one passable connected component
 * (Water/Wall block adjacency). Ensures mutual reachability for setup placement.
 */
export const TERRAIN_CONNECTIVITY_ERROR =
  'That placement would disconnect the map — every commander and objective must stay linked through passable terrain.'

export function terrainSetupStayConnected(
  commanders: OddR[],
  objectives: OddR[],
  terrain: TerrainMap,
  boardSize: number,
): boolean {
  const anchors: OddR[] = [...commanders, ...objectives]
  if (anchors.length <= 1) return true

  for (const a of anchors) {
    if (isImpassableTerrain(terrain[hexKey(a.col, a.row)])) return false
  }

  const reachable = passableReachableFrom(anchors[0]!, terrain, boardSize)
  for (let i = 1; i < anchors.length; i++) {
    if (!reachable.has(hexKey(anchors[i]!.col, anchors[i]!.row))) return false
  }
  return true
}

/**
 * Every commander must reach every objective through passable terrain
 * (not Water/Wall). Prevents pocketing players away from the objectives.
 */
export function allCommandersCanReachAllObjectives(
  commanders: OddR[],
  objectives: OddR[],
  terrain: TerrainMap,
  boardSize: number,
): boolean {
  return terrainSetupStayConnected(commanders, objectives, terrain, boardSize)
}

/**
 * Every listed commander must reach the board-center hex through passable
 * terrain (not Water/Wall). Used so water/wall cannot pocket a player.
 */
export function allCommandersCanReachCenter(
  commanders: OddR[],
  terrain: TerrainMap,
  boardSize: number,
): boolean {
  if (!commanders.length) return true
  const mid = Math.floor((boardSize - 1) / 2)
  const center: OddR = { col: mid, row: mid }
  const fromCenter = passableReachableFrom(center, terrain, boardSize)
  for (const c of commanders) {
    const key = hexKey(c.col, c.row)
    if (isImpassableTerrain(terrain[key])) return false
    if (!fromCenter.has(key)) return false
  }
  return true
}

/**
 * Commander must keep an open path through passable hexes out of their CR
 * (cannot be sealed in by Water/Wall).
 */
export function commanderHasEscapePath(
  commander: OddR,
  terrain: TerrainMap,
  boardSize: number,
  ownCrKeys: Set<string>,
): boolean {
  const startKey = hexKey(commander.col, commander.row)
  if (isImpassableTerrain(terrain[startKey])) return false

  const visited = new Set<string>()
  const queue: OddR[] = [commander]
  visited.add(startKey)

  while (queue.length) {
    const cur = queue.shift()!
    const curKey = hexKey(cur.col, cur.row)
    if (!ownCrKeys.has(curKey)) return true

    for (const n of neighborsOddR(cur)) {
      if (!inBounds(n, boardSize)) continue
      const nk = hexKey(n.col, n.row)
      if (visited.has(nk)) continue
      if (isImpassableTerrain(terrain[nk])) continue
      visited.add(nk)
      queue.push(n)
    }
  }
  return false
}

export function commandZoneSizeUsed(
  hand: TerrainQueueItem[],
  size: TerrainSizeClass,
): number {
  return hand.filter(
    (q) =>
      q.sizeClass === size &&
      (q.placed || q.skipped || (!q.placed && !q.skipped && !q.flooded)),
  ).length
}

export function commandZonePiecesComplete(
  hand: TerrainQueueItem[],
  quota: CommandZonePieceQuota,
): boolean {
  if (hand.some((q) => !q.placed && !q.skipped && !q.flooded)) return false
  for (const size of ['large', 'medium', 'small'] as const) {
    const used = hand.filter(
      (q) => q.sizeClass === size && (q.placed || q.skipped),
    ).length
    if (used < quota[size]) return false
  }
  return true
}

export function makeTerrainHandItem(
  def: TerrainPieceDef,
  seat: string,
  index: number,
): TerrainQueueItem {
  return {
    instanceId: `${seat}-${def.id}-${index}`,
    pieceId: def.id,
    name: def.name,
    kind: def.kind,
    sizeClass: def.sizeClass,
    shape: def.shape.map((c) => ({ ...c })),
    placed: false,
  }
}

export function terrainPieceById(pieceId: string): TerrainPieceDef | undefined {
  const fromDeck =
    LAND_TERRAIN_DECK.find((p) => p.id === pieceId) ??
    EXTRA_LAND_PIECES.find((p) => p.id === pieceId)
  if (fromDeck) return fromDeck
  const dash = pieceId.indexOf('-')
  if (dash <= 0) return undefined
  const kind = pieceId.slice(0, dash) as TerrainKind
  const shapeKey = pieceId.slice(dash + 1)
  if (!(TERRAIN_TYPE_META as Array<{ kind: TerrainKind }>).some((m) => m.kind === kind)) {
    return undefined
  }
  const large = buildTerrainPiece(shapeKey, kind, 'large')
  if (large?.id === pieceId) return large
  const medium = buildTerrainPiece(shapeKey, kind, 'medium')
  if (medium?.id === pieceId) return medium
  return undefined
}

export const TERRAIN_FILL: Record<TerrainKind, string> = {
  plains: '#605830',
  forest: '#2d4c2b',
  swamp: '#364436',
  desert: '#8c6533',
  volcanic: '#181210',
  hills: '#5a5040',
  water: '#40608c',
  wall: 'rgba(90, 95, 105, 0.95)',
}

// ═══════════════════════════════════════════════════════════════════════════
// FAVORED TERRAIN SYSTEM
// Units on their favored terrain gain combat bonuses (+1 Hit, +1 Damage).
// Bonuses are modest but meaningful — roughly equivalent to old "ignore difficult" power level.
// ═══════════════════════════════════════════════════════════════════════════

/** Favored terrain by race. */
export const RACE_FAVORED_TERRAIN: Record<string, TerrainKind> = {
  Human: 'plains',
  Construct: 'plains',
  Beastfolk: 'forest',
  Elf: 'forest',
  Dragon: 'volcanic',
  Demon: 'volcanic',
  Undead: 'swamp',
  Lizardman: 'swamp',
  Dwarf: 'hills',
}

/**
 * Flavorful keyword names for favored terrain (printed on cards or applied via race default).
 * These are also valid Keywords that grant the favored terrain bonus.
 */
export const TERRAIN_KEYWORD_NAMES: Record<TerrainKind, string> = {
  plains: 'Open Ground',
  forest: 'Woodwalker',
  swamp: 'Bogstrider',
  desert: 'Duneborn',
  volcanic: 'Ashborn',
  hills: 'Hillborn',
  water: 'Deepwalker',
  wall: 'Wallbreaker',
}

/** Inverse lookup: keyword name -> terrain kind. */
export const KEYWORD_TO_TERRAIN: Record<string, TerrainKind> = Object.fromEntries(
  Object.entries(TERRAIN_KEYWORD_NAMES).map(([kind, kw]) => [kw, kind as TerrainKind]),
)

/**
 * Combat bonuses on favored terrain.
 * Balanced to be meaningful but not overwhelming — replaces "ignore difficult" power level.
 */
export const FAVORED_TERRAIN_BONUS = {
  hit: 1,
  damage: 0,
} as const

/** Check if a race has favored terrain for a given terrain kind. */
export function isFavoredTerrain(
  race: string | null | undefined,
  terrain: TerrainKind | undefined,
  favoredTerrain?: string | null | undefined,
): boolean {
  if (!terrain) return false
  // Prefer explicit favoredTerrain field
  if (favoredTerrain) return favoredTerrain === terrain
  // Fallback to race default
  if (!race) return false
  return RACE_FAVORED_TERRAIN[race] === terrain
}

/** Get the favored terrain keyword name for a race. */
export function favoredTerrainKeywordForRace(race: string | null | undefined): string | null {
  if (!race) return null
  const terrain = RACE_FAVORED_TERRAIN[race]
  if (!terrain) return null
  return TERRAIN_KEYWORD_NAMES[terrain] ?? null
}

/** Check if a unit has a terrain keyword (either explicit or via race default). */
export function unitHasTerrainBonus(
  race: string | null | undefined,
  keywords: string[] | null | undefined,
  terrain: TerrainKind | undefined,
  favoredTerrain?: string | null | undefined,
): boolean {
  if (!terrain) return false
  // Prefer explicit favoredTerrain field
  if (favoredTerrain && favoredTerrain === terrain) return true
  // Fallback to keywords (legacy / special cases)
  const kwTerrain = KEYWORD_TO_TERRAIN[keywords?.find((k) => KEYWORD_TO_TERRAIN[k]) ?? '']
  if (kwTerrain === terrain) return true
  // Fallback to race default
  return isFavoredTerrain(race, terrain)
}
