/**
 * Seeded Minecraft-style biome map generation for the play board.
 * Biomes: plains / forest / swamp / desert / volcanic / mountains / water.
 * Commander CR areas are capped to a small amount of water.
 */

import {
  hexDistOddR,
  hexKey,
  inBounds,
  neighborsOddR,
  oddRToAxial,
  type OddR,
} from './hex'
import {
  commanderHasEscapePath,
  countWaterHexes,
  isImpassableTerrain,
  terrainSetupStayConnected,
  WATER_HEX_CAP,
  type TerrainKind,
  type TerrainMap,
} from './terrainPieces'
import type { SeatId } from './types'
import { DEFAULT_COMMANDER_COMMAND_RADIUS } from './constants'

/** Soft cap: water hexes inside a CR (fraction of CR size). */
export const CR_WATER_FRACTION_CAP = 0.08
/** Absolute max water hexes inside any single CR. */
export const CR_WATER_ABSOLUTE_MAX = 4

const LAND_BIOMES: TerrainKind[] = [
  'plains',
  'forest',
  'swamp',
  'desert',
  'volcanic',
  'mountains',
]

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit seed from room code (and optional salt). */
export function seedFromRoomCode(roomCode: string, salt = 'biome'): number {
  const s = `${roomCode}|${salt}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Deterministic lattice hash → 0..1 */
function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed
  n = (n ^ (n >>> 13)) >>> 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in axial space. */
function valueNoise(q: number, r: number, scale: number, seed: number): number {
  const x = q / scale
  const y = r / scale
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const v00 = hash2(x0, y0, seed)
  const v10 = hash2(x0 + 1, y0, seed)
  const v01 = hash2(x0, y0 + 1, seed)
  const v11 = hash2(x0 + 1, y0 + 1, seed)
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy)
}

function fbm(
  q: number,
  r: number,
  scale: number,
  seed: number,
  octaves = 4,
): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(q * freq, r * freq, scale, seed + i * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

function biomeFromClimate(temp: number, moist: number): TerrainKind {
  // Cold band
  if (temp < 0.34) {
    if (moist < 0.42) return 'mountains'
    if (moist > 0.68) return 'swamp'
    return moist < 0.55 ? 'forest' : 'plains'
  }
  // Hot band
  if (temp > 0.64) {
    if (moist < 0.38) return 'desert'
    if (moist > 0.66) return 'swamp'
    return 'volcanic'
  }
  // Temperate — wider plains so forest seas shrink
  if (moist < 0.38) return 'plains'
  if (moist < 0.5) return 'forest'
  if (moist > 0.74) return 'swamp'
  return moist < 0.62 ? 'forest' : 'plains'
}

/** Related biomes used to punch pockets into large flat regions. */
const BIOME_VARIANTS: Record<TerrainKind, TerrainKind[]> = {
  forest: ['plains', 'swamp', 'mountains'],
  volcanic: ['desert', 'mountains', 'plains'],
  desert: ['plains', 'volcanic', 'mountains'],
  mountains: ['forest', 'plains', 'volcanic'],
  swamp: ['forest', 'plains', 'mountains'],
  plains: ['forest', 'desert', 'swamp'],
  water: ['plains', 'swamp', 'forest'],
  wall: ['plains'],
}

function pickLandReplacement(
  temp: number,
  moist: number,
  rng: () => number,
): TerrainKind {
  const base = biomeFromClimate(temp, moist)
  if (base !== 'water' && LAND_BIOMES.includes(base)) return base
  return rng() < 0.5 ? 'plains' : 'forest'
}

/**
 * If the map is still under the water soft-cap, place a few mid-size ponds
 * (3–5 hex blobs) instead of scattered single tiles.
 */
function sprinkleExtraPonds(
  terrain: TerrainMap,
  boardSize: number,
  seed: number,
  objectiveKeys: Set<string>,
  commanders: Partial<Record<SeatId, OddR>>,
  moistAt: Map<string, number>,
  waterCap: number,
  rng: () => number,
): void {
  let waterCount = countWaterHexes(terrain)
  const target = Math.min(waterCap, Math.max(waterCount, Math.floor(waterCap * 0.88)))
  if (waterCount >= target) return

  const commanderKeys = new Set(
    Object.values(commanders)
      .filter((c): c is OddR => !!c)
      .map((c) => hexKey(c.col, c.row)),
  )

  const canPaint = (cell: OddR) => {
    if (!inBounds(cell, boardSize)) return false
    const key = hexKey(cell.col, cell.row)
    if (objectiveKeys.has(key) || commanderKeys.has(key)) return false
    const kind = terrain[key]
    return kind !== 'water' && kind !== 'wall'
  }

  const pondScale = Math.max(3.5, boardSize * 0.14)
  const candidates: Array<{ col: number; row: number; score: number }> = []
  for (let col = 0; col < boardSize; col++) {
    for (let row = 0; row < boardSize; row++) {
      if (!canPaint({ col, row })) continue
      const key = hexKey(col, row)
      const { q, r } = oddRToAxial(col, row)
      const pondN = fbm(q - 13, r + 21, pondScale, seed + 503, 3)
      const moist = moistAt.get(key) ?? 0.5
      if (pondN < 0.64) continue
      candidates.push({
        col,
        row,
        score: pondN * 0.7 + moist * 0.3 + rng() * 0.04,
      })
    }
  }
  candidates.sort((a, b) => b.score - a.score)

  for (const c of candidates) {
    if (waterCount >= target) break
    // Skip seeds that already sit next to water — grows existing lakes instead of speckles.
    const touchesWater = neighborsOddR(c).some(
      (n) => inBounds(n, boardSize) && terrain[hexKey(n.col, n.row)] === 'water',
    )
    // Prefer growing existing water occasionally; otherwise plant a small pond blob.
    const blobTarget = 3 + Math.floor(rng() * 3) // 3–5
    const queue: OddR[] = [c]
    const painted = new Set<string>()
    while (queue.length && painted.size < blobTarget && waterCount < target) {
      const cur = queue.shift()!
      const key = hexKey(cur.col, cur.row)
      if (painted.has(key)) continue
      if (!canPaint(cur) && terrain[key] !== 'water') continue
      if (terrain[key] !== 'water') {
        terrain[key] = 'water'
        waterCount++
      }
      painted.add(key)
      const nbs = neighborsOddR(cur).filter((n) => canPaint(n) || terrain[hexKey(n.col, n.row)] === 'water')
      for (let i = nbs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[nbs[i], nbs[j]] = [nbs[j]!, nbs[i]!]
      }
      for (const n of nbs.slice(0, 2)) queue.push(n)
    }
    // Don't plant another pond too close — skip remaining candidates near this blob.
    if (!touchesWater && painted.size > 0) {
      // continue; spacing handled by candidate density + pondN threshold
    }
  }
}

/**
 * Carve a few mid-size related pockets into large mono-biome regions.
 * Avoids single-hex speckles so biomes still read as coherent chunks.
 */
function breakUpFlatBiomes(
  terrain: TerrainMap,
  boardSize: number,
  seed: number,
  objectiveKeys: Set<string>,
): void {
  const pocketScale = Math.max(4.2, boardSize * 0.16)

  for (let col = 0; col < boardSize; col++) {
    for (let row = 0; row < boardSize; row++) {
      const key = hexKey(col, row)
      if (objectiveKeys.has(key)) continue
      const kind = terrain[key]
      if (!kind || kind === 'water' || kind === 'wall') continue

      const { q, r } = oddRToAxial(col, row)
      const variants = BIOME_VARIANTS[kind]
      if (!variants?.length) continue

      // Only deep interiors of large same-biome slabs.
      let same = 0
      let neigh = 0
      for (const n of neighborsOddR({ col, row })) {
        if (!inBounds(n, boardSize)) continue
        neigh++
        if (terrain[hexKey(n.col, n.row)] === kind) same++
      }
      if (neigh < 4 || same < neigh - 1) continue

      // Smooth mid-frequency pockets only — no micro speckles.
      const pocket = fbm(q, r, pocketScale, seed + 211, 3)
      if (pocket <= 0.66) continue
      const micro = hash2(col * 3 + 1, row * 5 + 2, seed + 419)
      terrain[key] = variants[Math.floor(micro * variants.length) % variants.length]!
    }
  }
}

/** Absorb salt-and-pepper isolates into the majority neighbor biome. */
function coalesceIsolates(
  terrain: TerrainMap,
  boardSize: number,
  objectiveKeys: Set<string>,
  passes = 2,
): void {
  for (let pass = 0; pass < passes; pass++) {
    const updates: Array<{ key: string; kind: TerrainKind }> = []
    for (let col = 0; col < boardSize; col++) {
      for (let row = 0; row < boardSize; row++) {
        const key = hexKey(col, row)
        if (objectiveKeys.has(key)) continue
        const kind = terrain[key]
        if (!kind || kind === 'wall') continue

        const counts = new Map<TerrainKind, number>()
        let neigh = 0
        let same = 0
        for (const n of neighborsOddR({ col, row })) {
          if (!inBounds(n, boardSize)) continue
          const nk = terrain[hexKey(n.col, n.row)]
          if (!nk || nk === 'wall') continue
          neigh++
          if (nk === kind) same++
          counts.set(nk, (counts.get(nk) ?? 0) + 1)
        }
        if (neigh < 3) continue
        // Only fully isolated hexes (0 same neighbors) — keeps 2–3 hex clumps intact.
        if (same > 0) continue
        let best: TerrainKind | null = null
        let bestN = 0
        for (const [k, n] of counts) {
          if (n > bestN) {
            best = k
            bestN = n
          }
        }
        if (best && best !== kind && bestN >= 2) {
          updates.push({ key, kind: best })
        }
      }
    }
    for (const u of updates) terrain[u.key] = u.kind
  }
}

export type RandomMapOpts = {
  boardSize: number
  roomCode: string
  commanders: Partial<Record<SeatId, OddR>>
  commanderRadii: Partial<Record<SeatId, number>>
  /** Objective hexes stay plains for gameplay; still written as plains. */
  objectiveKeys?: Set<string>
  /** Soft global water cap (defaults to WATER_HEX_CAP). */
  waterCap?: number
}

function commandRadiusKeysLocal(
  origin: OddR,
  radius: number,
  boardSize: number,
): Set<string> {
  const keys = new Set<string>()
  for (let col = 0; col < boardSize; col++) {
    for (let row = 0; row < boardSize; row++) {
      const cell = { col, row }
      if (hexDistOddR(origin, cell) <= radius && inBounds(cell, boardSize)) {
        keys.add(hexKey(col, row))
      }
    }
  }
  return keys
}

/**
 * Generate a full-board biome TerrainMap.
 * Keeps water scarce inside each commander CR and under the global water soft-cap.
 */
export function generateRandomBiomeMap(opts: RandomMapOpts): TerrainMap {
  const {
    boardSize,
    roomCode,
    commanders,
    commanderRadii,
    objectiveKeys = new Set(),
    waterCap = WATER_HEX_CAP,
  } = opts
  const seed = seedFromRoomCode(roomCode)
  const rng = mulberry32(seed ^ 0x9e3779b9)

  // Climate scales: mid-size continents that still read as coherent chunks.
  const climateScale = Math.max(5.5, boardSize * 0.26)
  const moistScale = Math.max(5, boardSize * 0.23)
  const waterScale = Math.max(4, boardSize * 0.18)
  const warpScale = Math.max(3.5, boardSize * 0.12)

  const tempAt = new Map<string, number>()
  const moistAt = new Map<string, number>()
  const terrain: TerrainMap = {}

  for (let col = 0; col < boardSize; col++) {
    for (let row = 0; row < boardSize; row++) {
      const key = hexKey(col, row)
      const { q, r } = oddRToAxial(col, row)
      // Latitude bias (north colder, south hotter) + gentle warp.
      const lat = boardSize <= 1 ? 0.5 : row / (boardSize - 1)
      const warpQ = q + (fbm(q, r, warpScale, seed + 91, 3) - 0.5) * 3.2
      const warpR = r + (fbm(q + 9, r - 5, warpScale, seed + 97, 3) - 0.5) * 3.2
      const tempNoise = fbm(warpQ, warpR, climateScale, seed + 11, 4)
      const moist =
        fbm(warpQ, warpR, moistScale, seed + 29, 4) * 0.8 +
        fbm(warpQ, warpR, warpScale, seed + 37, 3) * 0.2
      const waterN = fbm(warpQ + 40, warpR - 17, waterScale, seed + 47, 3)
      const ridge = fbm(warpQ * 0.7, warpR * 0.7, climateScale * 0.55, seed + 71, 3)
      // Light jitter only — keeps chunks flowing instead of salt-and-pepper.
      const microT = (valueNoise(q, r, 3.2, seed + 113) - 0.5) * 0.06
      const microM = (valueNoise(q, r, 3.0, seed + 127) - 0.5) * 0.07
      const temp = Math.min(
        1,
        Math.max(
          0,
          tempNoise * 0.5 + lat * 0.48 + (ridge - 0.5) * 0.2 + microT,
        ),
      )
      const moistClamped = Math.min(1, Math.max(0, moist + microM))
      tempAt.set(key, temp)
      moistAt.set(key, moistClamped)

      if (objectiveKeys.has(key)) {
        terrain[key] = 'plains'
        continue
      }

      // Lakes / river veins — a bit more generous so maps aren't too dry.
      const waterThresh = 0.66 - moistClamped * 0.06
      if (waterN > waterThresh && ridge > 0.36) {
        terrain[key] = 'water'
      } else {
        terrain[key] = biomeFromClimate(temp, moistClamped)
      }
    }
  }

  // Mid-size related pockets inside large slabs (not single-hex noise).
  breakUpFlatBiomes(terrain, boardSize, seed, objectiveKeys)
  // Clean leftover isolates so terrain reads as flowing chunks.
  coalesceIsolates(terrain, boardSize, objectiveKeys, 2)

  // Scatter a few extra ponds if the map is still dry (under soft cap).
  sprinkleExtraPonds(
    terrain,
    boardSize,
    seed,
    objectiveKeys,
    commanders,
    moistAt,
    waterCap,
    rng,
  )
  // One more cleanup after ponds so leftover single tiles don't speck the map.
  coalesceIsolates(terrain, boardSize, objectiveKeys, 1)

  // Soft global water cap — convert excess water to land biomes.
  let waterCount = countWaterHexes(terrain)
  if (waterCount > waterCap) {
    const waterKeys = Object.keys(terrain).filter((k) => terrain[k] === 'water')
    // Shuffle deterministically
    for (let i = waterKeys.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[waterKeys[i], waterKeys[j]] = [waterKeys[j]!, waterKeys[i]!]
    }
    for (const key of waterKeys) {
      if (waterCount <= waterCap) break
      if (objectiveKeys.has(key)) continue
      terrain[key] = pickLandReplacement(
        tempAt.get(key) ?? 0.5,
        moistAt.get(key) ?? 0.5,
        rng,
      )
      waterCount--
    }
  }

  // Limit water inside each commander CR.
  for (const seat of Object.keys(commanders) as SeatId[]) {
    const origin = commanders[seat]
    if (!origin) continue
    const radius = commanderRadii[seat] ?? DEFAULT_COMMANDER_COMMAND_RADIUS
    const crKeys = commandRadiusKeysLocal(origin, radius, boardSize)
    const maxWater = Math.max(
      0,
      Math.min(
        CR_WATER_ABSOLUTE_MAX,
        Math.floor(crKeys.size * CR_WATER_FRACTION_CAP),
      ),
    )
    const waterInCr = [...crKeys].filter((k) => terrain[k] === 'water')
    if (waterInCr.length <= maxWater) continue

    // Prefer converting water farthest from commander (keep shore near edge of map feel).
    waterInCr.sort((a, b) => {
      const [ac, ar] = a.split(',').map(Number) as [number, number]
      const [bc, br] = b.split(',').map(Number) as [number, number]
      const da =
        Math.abs(ac - origin.col) + Math.abs(ar - origin.row)
      const db =
        Math.abs(bc - origin.col) + Math.abs(br - origin.row)
      return db - da || (rng() < 0.5 ? -1 : 1)
    })
    let keep = maxWater
    for (const key of waterInCr) {
      if (keep > 0) {
        keep--
        continue
      }
      if (objectiveKeys.has(key)) continue
      terrain[key] = pickLandReplacement(
        tempAt.get(key) ?? 0.5,
        moistAt.get(key) ?? 0.5,
        rng,
      )
    }

    // Commander hex must be soft land (not water).
    const cmdKey = hexKey(origin.col, origin.row)
    if (isImpassableTerrain(terrain[cmdKey])) {
      terrain[cmdKey] = 'plains'
    }
  }

  // Repair escape paths / connectivity by flipping blocking water to plains.
  repairConnectivity(terrain, boardSize, commanders, commanderRadii, objectiveKeys, rng)

  return terrain
}

function repairConnectivity(
  terrain: TerrainMap,
  boardSize: number,
  commanders: Partial<Record<SeatId, OddR>>,
  commanderRadii: Partial<Record<SeatId, number>>,
  objectiveKeys: Set<string>,
  rng: () => number,
): void {
  const commanderList = Object.values(commanders).filter(
    (c): c is OddR => !!c,
  )
  const objectiveHexes = [...objectiveKeys].map((k) => {
    const [col, row] = k.split(',').map(Number) as [number, number]
    return { col, row }
  })

  const fixWaterNear = (cell: OddR) => {
    const key = hexKey(cell.col, cell.row)
    if (terrain[key] === 'water') terrain[key] = 'plains'
    for (const n of neighborsOddR(cell)) {
      if (!inBounds(n, boardSize)) continue
      const nk = hexKey(n.col, n.row)
      if (terrain[nk] === 'water' && rng() < 0.55) terrain[nk] = 'plains'
    }
  }

  for (let pass = 0; pass < 8; pass++) {
    let ok = true
    for (const seat of Object.keys(commanders) as SeatId[]) {
      const origin = commanders[seat]
      if (!origin) continue
      const radius = commanderRadii[seat] ?? DEFAULT_COMMANDER_COMMAND_RADIUS
      const cr = commandRadiusKeysLocal(origin, radius, boardSize)
      if (!commanderHasEscapePath(origin, terrain, boardSize, cr)) {
        ok = false
        fixWaterNear(origin)
        // Clear a path outward toward board center.
        const mid = Math.floor(boardSize / 2)
        let cur = { ...origin }
        for (let step = 0; step < radius + 3; step++) {
          const nbs = neighborsOddR(cur).filter((n) => inBounds(n, boardSize))
          nbs.sort(
            (a, b) =>
              Math.abs(a.col - mid) +
              Math.abs(a.row - mid) -
              (Math.abs(b.col - mid) + Math.abs(b.row - mid)),
          )
          const next = nbs[0]
          if (!next) break
          const nk = hexKey(next.col, next.row)
          if (terrain[nk] === 'water') terrain[nk] = 'plains'
          cur = next
          if (!cr.has(nk)) break
        }
      }
    }
    if (
      !terrainSetupStayConnected(
        commanderList,
        objectiveHexes,
        terrain,
        boardSize,
      )
    ) {
      ok = false
      // Convert a scattered sample of water to plains.
      const waters = Object.keys(terrain).filter((k) => terrain[k] === 'water')
      for (const key of waters) {
        if (rng() < 0.12) terrain[key] = 'plains'
      }
    }
    if (ok) break
  }

  // Final: never leave commanders on water.
  for (const origin of commanderList) {
    const key = hexKey(origin.col, origin.row)
    if (isImpassableTerrain(terrain[key])) terrain[key] = 'plains'
  }
}

/** Square corner wedges used for default (player-built center) maps. */
export function isCornerTerrainHex(
  col: number,
  row: number,
  boardSize: number,
): boolean {
  const span = Math.max(6, Math.round(boardSize * 0.26))
  const left = col < span
  const right = col >= boardSize - span
  const top = row < span
  const bottom = row >= boardSize - span
  return (left && top) || (left && bottom) || (right && top) || (right && bottom)
}

/**
 * Random biomes in the four corners only. Center and edge CRs stay empty so
 * players can flood command zones and drop land in the middle.
 */
export function generateCornerBiomeMap(opts: RandomMapOpts): TerrainMap {
  const full = generateRandomBiomeMap(opts)
  const {
    boardSize,
    commanders,
    commanderRadii,
    objectiveKeys = new Set(),
  } = opts
  const crKeys = new Set<string>()
  for (const seat of Object.keys(commanders) as SeatId[]) {
    const origin = commanders[seat]
    if (!origin) continue
    const radius = commanderRadii[seat] ?? DEFAULT_COMMANDER_COMMAND_RADIUS
    for (const key of commandRadiusKeysLocal(origin, radius, boardSize)) {
      crKeys.add(key)
    }
  }
  const next: TerrainMap = {}
  for (const [key, kind] of Object.entries(full)) {
    if (objectiveKeys.has(key) || crKeys.has(key)) continue
    const [col, row] = key.split(',').map(Number)
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue
    if (!isCornerTerrainHex(col, row, boardSize)) continue
    next[key] = kind
  }
  return next
}
