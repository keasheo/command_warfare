/** Terrain movement costs and pathfinding for play + sims. */

import {
  hexDistOddR,
  hexKey,
  inBounds,
  neighborsOddR,
  type OddR,
} from './hex'
import {
  isImpassableTerrain,
  terrainAt,
  type TerrainKind,
  type TerrainMap,
} from './terrainPieces'

/**
 * Movement point cost to *enter* a hex of this kind (before specials).
 * Non-water terrain costs 1 (no penalties); water is impassable without Amphibious.
 * Terrain bonuses (favored terrain) are handled separately via combat modifiers.
 */
export const TERRAIN_MOVE_COST: Record<TerrainKind, number> = {
  plains: 1,
  forest: 1,
  desert: 1,
  swamp: 1,
  volcanic: 1,
  hills: 1,
  water: Infinity,
  wall: Infinity,
}

export type MoveTraveler = {
  /** Treat water as cost 1 instead of impassable. */
  amphibious?: boolean
  /** All terrain costs are 1 if passable (Flying). */
  flying?: boolean
  /** Cannot use the minimum-1 override. */
  rooted?: boolean
  /** Slow status: −1 effective Move budget. */
  slow?: boolean
}

export type MoveCostOptions = MoveTraveler & {
  /**
   * Free Move 1 (Harass, ability steps, etc.): passable hexes cost 1 regardless
   * of printed terrain cost. Impassable terrain stays impassable.
   */
  ignoreTerrainCosts?: boolean
}

/** Cost to enter `kind` for this traveler. Infinity = cannot enter. */
export function terrainEnterCost(
  kind: TerrainKind | undefined,
  opts: MoveCostOptions = {},
): number {
  const terrain = kind ?? 'plains'
  if (opts.flying) {
    if (terrain === 'wall') return Infinity
    return 1
  }
  if (opts.ignoreTerrainCosts) {
    if (isImpassableTerrain(terrain)) {
      if (terrain === 'water' && opts.amphibious) return 1
      return Infinity
    }
    return 1
  }
  if (terrain === 'water') {
    return opts.amphibious ? 1 : Infinity
  }
  if (terrain === 'wall') return Infinity
  return TERRAIN_MOVE_COST[terrain] ?? 1
}

export function canEnterTerrain(
  kind: TerrainKind | undefined,
  opts: MoveCostOptions = {},
): boolean {
  return terrainEnterCost(kind, opts) < Infinity
}

/**
 * Cost to traverse a hex during pathfinding. Flying may pass over Wall (cost 1)
 * but still cannot end a move there (see canEndMoveOnTerrain).
 */
export function terrainTraverseCost(
  kind: TerrainKind | undefined,
  opts: MoveCostOptions = {},
): number {
  const terrain = kind ?? 'plains'
  if (opts.flying && terrain === 'wall') return 1
  return terrainEnterCost(kind, opts)
}

/** Whether a traveler may end a move on this terrain kind. */
export function canEndMoveOnTerrain(
  kind: TerrainKind | undefined,
  opts: MoveCostOptions = {},
): boolean {
  const terrain = kind ?? 'plains'
  if (opts.flying && terrain === 'wall') return false
  return terrainEnterCost(kind, opts) < Infinity
}

/**
 * Whether a unit with `remaining` movement may spend to enter a hex of `cost`.
 * Minimum-1 rule: if remaining > 0 and not rooted, any finite cost is allowed
 * (remaining becomes 0 after the step when cost > remaining).
 */
export function canAffordEnter(
  remaining: number,
  cost: number,
  opts: { rooted?: boolean; ignoreTerrainCosts?: boolean } = {},
): boolean {
  if (!(cost < Infinity)) return false
  if (remaining <= 0) return false
  if (opts.ignoreTerrainCosts) return cost <= remaining
  if (cost <= remaining) return true
  return !opts.rooted
}

/** Movement left after entering a hex that cost `cost`. */
export function remainingAfterEnter(remaining: number, cost: number): number {
  return Math.max(0, remaining - cost)
}

export type ReachableCell = {
  col: number
  row: number
  /** Movement remaining upon arriving here (best / highest). */
  remaining: number
  /** Movement spent from the start budget to arrive here. */
  spent: number
  /** Previous hex key for path reconstruction (null at origin). */
  prev: string | null
}

/**
 * Dijkstra reachability under terrain costs + minimum-1 rule.
 * Occupied hexes (except origin) cannot be entered unless Flying traverses
 * a friendly-occupied hex (may pass through, not stop).
 */
export function reachableMoveHexes(opts: {
  origin: OddR
  budget: number
  boardSize: number
  terrain: TerrainMap
  occupied?: Set<string>
  /** Friendly unit hex keys — Flying may path through these. */
  friendlyOccupied?: Set<string>
  traveler?: MoveCostOptions
  /** Cap steps (for free Move 1). */
  maxSteps?: number
}): Map<string, ReachableCell> {
  const {
    origin,
    budget,
    boardSize,
    terrain,
    occupied = new Set(),
    friendlyOccupied = new Set(),
    traveler = {},
    maxSteps,
  } = opts
  const originKey = hexKey(origin.col, origin.row)
  const best = new Map<string, ReachableCell>()
  best.set(originKey, {
    col: origin.col,
    row: origin.row,
    remaining: budget,
    spent: 0,
    prev: null,
  })

  type Node = { col: number; row: number; remaining: number; spent: number; steps: number }
  const queue: Node[] = [
    { col: origin.col, row: origin.row, remaining: budget, spent: 0, steps: 0 },
  ]

  while (queue.length) {
    // Prefer higher remaining (simple queue; board is small enough).
    queue.sort((a, b) => b.remaining - a.remaining || a.spent - b.spent)
    const cur = queue.shift()!
    const curKey = hexKey(cur.col, cur.row)
    const known = best.get(curKey)
    if (!known || cur.remaining < known.remaining) continue
    if (maxSteps != null && cur.steps >= maxSteps) continue
    if (cur.remaining <= 0 && !(maxSteps != null && cur.steps < maxSteps)) {
      // May still be at origin with 0 — nothing to expand usefully for paid moves.
      if (cur.steps > 0) continue
    }

    for (const n of neighborsOddR(cur)) {
      if (!inBounds(n, boardSize)) continue
      const nk = hexKey(n.col, n.row)
      if (nk !== originKey && occupied.has(nk)) {
        const traverseFriendly =
          traveler.flying && friendlyOccupied.has(nk)
        if (!traverseFriendly) continue
      }
      const kind = terrainAt(terrain, n.col, n.row)
      const cost = terrainTraverseCost(kind, traveler)
      if (
        !canAffordEnter(cur.remaining, cost, {
          rooted: traveler.rooted,
          ignoreTerrainCosts: traveler.ignoreTerrainCosts,
        })
      ) {
        continue
      }
      const nextRem = remainingAfterEnter(cur.remaining, cost)
      const nextSpent = cur.spent + (cur.remaining - nextRem)
      const prevBest = best.get(nk)
      if (prevBest && nextRem <= prevBest.remaining && nextSpent >= prevBest.spent) {
        continue
      }
      best.set(nk, {
        col: n.col,
        row: n.row,
        remaining: nextRem,
        spent: nextSpent,
        prev: curKey,
      })
      queue.push({
        col: n.col,
        row: n.row,
        remaining: nextRem,
        spent: nextSpent,
        steps: cur.steps + 1,
      })
    }
  }

  return best
}

export function reconstructMovePath(
  reach: Map<string, ReachableCell>,
  dest: OddR,
): OddR[] | null {
  const destKey = hexKey(dest.col, dest.row)
  if (!reach.has(destKey)) return null
  const path: OddR[] = []
  let key: string | null = destKey
  const guard = reach.size + 2
  let i = 0
  while (key && i++ < guard) {
    const cell = reach.get(key)
    if (!cell) return null
    path.push({ col: cell.col, row: cell.row })
    key = cell.prev
  }
  path.reverse()
  return path
}

/** Validate a paid move from origin → dest. */
export function validateTerrainMove(opts: {
  origin: OddR
  dest: OddR
  budget: number
  boardSize: number
  terrain: TerrainMap
  occupied?: Set<string>
  friendlyOccupied?: Set<string>
  traveler?: MoveCostOptions
  /**
   * Prototype: allow paths that cost more than remaining Move
   * (Harass / Trample / free steps). Overspend is reported, not rejected.
   */
  allowOverspend?: boolean
}):
  | {
      ok: true
      spent: number
      remaining: number
      path: OddR[]
      overspend: boolean
    }
  | { ok: false; error: string } {
  const slowPenalty = opts.traveler?.slow ? 1 : 0
  const effectiveBudget = Math.max(0, opts.budget - slowPenalty)
  const dist = hexDistOddR(opts.origin, opts.dest)
  if (dist < 1) return { ok: false, error: 'Already on that hex.' }
  if (!opts.allowOverspend && effectiveBudget <= 0) {
    if (opts.traveler?.rooted) {
      return { ok: false, error: 'Rooted units cannot move.' }
    }
    if (opts.traveler?.slow && opts.budget > 0) {
      return { ok: false, error: 'Slow reduces Move to 0 this activation.' }
    }
    return { ok: false, error: 'No Move remaining this activation.' }
  }

  // Soft budget finds a legal terrain path even when Move is spent.
  const reachBudget = opts.allowOverspend
    ? Math.max(effectiveBudget, 24)
    : effectiveBudget

  const destKind = terrainAt(opts.terrain, opts.dest.col, opts.dest.row)
  if (!canEndMoveOnTerrain(destKind, opts.traveler)) {
    return { ok: false, error: 'Flying units cannot land on Wall hexes.' }
  }

  const reach = reachableMoveHexes({
    origin: opts.origin,
    budget: reachBudget,
    boardSize: opts.boardSize,
    terrain: opts.terrain,
    occupied: opts.occupied,
    friendlyOccupied: opts.friendlyOccupied,
    traveler: opts.traveler,
  })
  const destKey = hexKey(opts.dest.col, opts.dest.row)
  const cell = reach.get(destKey)
  if (!cell || !cell.prev) {
    return {
      ok: false,
      error: opts.allowOverspend
        ? 'Destination is not reachable (blocked / terrain).'
        : 'Destination is not reachable with remaining Move (terrain costs).',
    }
  }
  const path = reconstructMovePath(reach, opts.dest)
  if (!path || path.length < 2) {
    return { ok: false, error: 'No legal path.' }
  }
  const overspend = cell.spent > effectiveBudget
  if (overspend && !opts.allowOverspend) {
    return {
      ok: false,
      error: 'Destination is not reachable with remaining Move (terrain costs).',
    }
  }
  return {
    ok: true,
    spent: cell.spent,
    remaining: Math.max(0, opts.budget - cell.spent),
    path,
    overspend,
  }
}

/** Free Move 1: one adjacent passable hex; ignores printed terrain costs. */
export function validateFreeMove1(opts: {
  origin: OddR
  dest: OddR
  boardSize: number
  terrain: TerrainMap
  occupied?: Set<string>
  traveler?: MoveTraveler
}): { ok: true } | { ok: false; error: string } {
  if (opts.traveler?.rooted) {
    return { ok: false, error: 'Rooted units cannot move.' }
  }
  const dist = hexDistOddR(opts.origin, opts.dest)
  if (dist !== 1) return { ok: false, error: 'Free Move must be exactly 1 hex.' }
  if (!inBounds(opts.dest, opts.boardSize)) {
    return { ok: false, error: 'Out of bounds.' }
  }
  const key = hexKey(opts.dest.col, opts.dest.row)
  if (opts.occupied?.has(key)) return { ok: false, error: 'Hex occupied.' }
  const destKind = terrainAt(opts.terrain, opts.dest.col, opts.dest.row)
  if (!canEndMoveOnTerrain(destKind, opts.traveler)) {
    return { ok: false, error: 'Flying units cannot land on Wall hexes.' }
  }
  const cost = terrainEnterCost(destKind, {
    ...opts.traveler,
    ignoreTerrainCosts: true,
  })
  if (!(cost < Infinity)) {
    return { ok: false, error: 'Cannot enter that terrain.' }
  }
  return { ok: true }
}
