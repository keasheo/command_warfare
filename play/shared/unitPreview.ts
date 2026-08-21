/**
 * Selection overlays: reachable move hexes, attack range, officer CR.
 */
import { hexDistOddR, hexKey, type OddR } from './hex'
import { reachableMoveHexes, type MoveCostOptions } from './movement'
import { effectiveRange } from './combatResolve'
import type { GameState, UnitToken } from './types'

function travelerFromUnit(unit: UnitToken): MoveCostOptions {
  const kws = unit.keywords ?? []
  const has = (name: string) =>
    kws.some((k) => k === name || String(k).startsWith(`${name} `))
  return {
    flying: has('Flying'),
    amphibious: has('Amphibious'),
    rooted: Boolean(unit.rooted),
    slow: Boolean(unit.slow),
  }
}

function occupiedKeys(state: GameState, excludeId?: string): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) {
    if (u.id === excludeId) continue
    s.add(hexKey(u.col, u.row))
  }
  return s
}

function friendlyOccupiedKeys(
  state: GameState,
  seat: UnitToken['seat'],
  excludeId: string,
): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) {
    if (u.seat === seat && u.id !== excludeId) s.add(hexKey(u.col, u.row))
  }
  return s
}

function printedMove(unit: UnitToken): number {
  return Math.max(0, (unit.move ?? 0) + (unit.tempMove || 0))
}

/** Move budget to preview: remaining if this model is mid-activation, else printed. */
export function previewMoveBudget(
  state: GameState,
  unit: UnitToken,
): number {
  if (unit.rooted) return 0
  const printed = printedMove(unit)
  if (unit.kind === 'commander') {
    return unit.moveRemaining > 0 ? unit.moveRemaining : printed
  }
  const activeOfficerId = state.activeCompanyOfficerId
  if (!activeOfficerId) return printed
  const officer = state.units.find((u) => u.id === activeOfficerId)
  if (!officer || officer.seat !== unit.seat) return printed
  const inCompany =
    unit.id === officer.id || unit.officerCardId === officer.cardId
  if (!inCompany) return printed
  return Math.max(0, unit.moveRemaining)
}

export function unitMovePreviewKeys(
  state: GameState,
  unit: UnitToken,
): Set<string> {
  const budget = previewMoveBudget(state, unit)
  if (budget <= 0) return new Set()
  const origin: OddR = { col: unit.col, row: unit.row }
  const originKey = hexKey(origin.col, origin.row)
  const occ = occupiedKeys(state, unit.id)
  const reach = reachableMoveHexes({
    origin,
    budget,
    boardSize: state.boardSize,
    terrain: state.terrain ?? {},
    occupied: occ,
    friendlyOccupied: friendlyOccupiedKeys(state, unit.seat, unit.id),
    traveler: travelerFromUnit(unit),
  })
  const keys = new Set<string>()
  for (const [key, cell] of reach) {
    if (key === originKey) continue
    if (cell.spent <= 0) continue
    if (occ.has(key)) continue
    keys.add(key)
  }
  return keys
}

export function unitAttackPreviewKeys(
  state: GameState,
  unit: UnitToken,
): Set<string> {
  const range = effectiveRange(unit)
  if (range <= 0) return new Set()
  const origin: OddR = { col: unit.col, row: unit.row }
  const keys = new Set<string>()
  for (let row = 0; row < state.boardSize; row++) {
    for (let col = 0; col < state.boardSize; col++) {
      if (col === origin.col && row === origin.row) continue
      if (hexDistOddR(origin, { col, row }) <= range) {
        keys.add(hexKey(col, row))
      }
    }
  }
  return keys
}
