/** Formation Drill / Guard / March — cheap same-company adjacency auras. */

import { hexDistOddR } from './hex'
import type { CardSnapshot } from './army'
import type { GameState, UnitToken } from './types'

/** UV threshold for Formation aura beneficiaries (inclusive). */
export const FORMATION_UV_CAP = 3

export const FORMATION_DRILL = 'Formation Drill'
export const FORMATION_GUARD = 'Formation Guard'
export const FORMATION_MARCH = 'Formation March'

function catalogCard(
  state: GameState,
  cardId: string | null | undefined,
): CardSnapshot | null {
  if (!cardId) return null
  return state.cardCatalog?.[cardId] ?? null
}

function unitHasFormationKeyword(unit: UnitToken, keyword: string): boolean {
  const needle = keyword.toLowerCase()
  if ((unit.abilities ?? []).some((a) => a.toLowerCase() === needle)) return true
  return (unit.keywords ?? []).some(
    (k) => k.toLowerCase() === needle || k.toLowerCase().startsWith(`${needle} `),
  )
}

/** Printed UV for a token (from catalog). */
export function unitUv(state: GameState, unit: UnitToken): number | null {
  const uv = catalogCard(state, unit.cardId)?.uv
  return typeof uv === 'number' && Number.isFinite(uv) ? uv : null
}

/** True if this model can receive Formation auras (UV ≤ cap). */
export function isFormationCheapUnit(state: GameState, unit: UnitToken): boolean {
  const uv = unitUv(state, unit)
  return uv != null && uv <= FORMATION_UV_CAP
}

/** Same company: share officerCardId (officer's points at self). */
export function sameCompany(a: UnitToken, b: UnitToken): boolean {
  return (
    a.seat === b.seat &&
    !!a.officerCardId &&
    !!b.officerCardId &&
    a.officerCardId === b.officerCardId
  )
}

/**
 * Adjacent same-company ally that provides the given Formation keyword.
 * The beneficiary does not need the keyword — the provider does.
 */
export function hasAdjacentFormationProvider(
  state: GameState,
  unit: UnitToken,
  keyword: string,
): boolean {
  return state.units.some(
    (m) =>
      m.id !== unit.id &&
      sameCompany(m, unit) &&
      hexDistOddR(m, unit) === 1 &&
      unitHasFormationKeyword(m, keyword),
  )
}

/** +1 Move while adjacent to Formation March (UV ≤ 3). */
export function formationMarchBonus(state: GameState, unit: UnitToken): number {
  if (!isFormationCheapUnit(state, unit)) return 0
  if (!hasAdjacentFormationProvider(state, unit, FORMATION_MARCH)) return 0
  return 1
}

/** +1 Hit (lower hit need by 1) while adjacent to Formation Drill (UV ≤ 3). */
export function formationDrillHitBonus(state: GameState, unit: UnitToken): number {
  if (!isFormationCheapUnit(state, unit)) return 0
  if (!hasAdjacentFormationProvider(state, unit, FORMATION_DRILL)) return 0
  return 1
}

/**
 * +1 Toughness while defending near Formation Guard (UV ≤ 3).
 * Implemented as Harden-style −1 damage (floor 1), matching battle sim.
 */
export function formationGuardMitigation(state: GameState, unit: UnitToken): number {
  if (!isFormationCheapUnit(state, unit)) return 0
  if (!hasAdjacentFormationProvider(state, unit, FORMATION_GUARD)) return 0
  return 1
}
