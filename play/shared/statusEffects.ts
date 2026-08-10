import { hasUnitAbility } from './combatResolve'
import type { UnitToken } from './types'

/** Defaults for a freshly spawned unit token. */
export const DEFAULT_UNIT_STATUSES: Pick<
  UnitToken,
  | 'fear'
  | 'slow'
  | 'tempFearless'
  | 'unyielding'
  | 'bonePrisoned'
  | 'terrorFear'
  | 'slowPendingClear'
> = {
  fear: false,
  slow: false,
  tempFearless: false,
  unyielding: false,
  bonePrisoned: false,
  terrorFear: false,
  slowPendingClear: false,
}

export function unitHasFearless(unit: UnitToken): boolean {
  return hasUnitAbility(unit, 'Fearless') || !!unit.tempFearless
}

export function unitHasFearPenalty(unit: UnitToken): boolean {
  return (
    (!!unit.fear || !!unit.terrorFear) &&
    !unitHasFearless(unit)
  )
}

export function canGainFear(unit: UnitToken): boolean {
  return !unitHasFearless(unit)
}

export function patchFear(unit: UnitToken): Partial<UnitToken> {
  return canGainFear(unit) ? { fear: true } : {}
}

export function patchRoot(): Partial<UnitToken> {
  return { rooted: true }
}

export function patchSlow(): Partial<UnitToken> {
  return { slow: true }
}

export function patchTempFearless(): Partial<UnitToken> {
  return { tempFearless: true }
}

export function patchUnyielding(): Partial<UnitToken> {
  return { unyielding: true }
}

export function patchBonePrison(): Partial<UnitToken> {
  return { rooted: true, bonePrisoned: true }
}

/** Movement budget after Slow (−1 Move, minimum 0). */
export function effectiveMoveBudget(unit: UnitToken, remaining: number): number {
  if (unit.rooted) return 0
  const slowPenalty = unit.slow ? 1 : 0
  return Math.max(0, remaining - slowPenalty)
}

/** Statuses cleared at round refresh (matches battleSim resetRoundFlags). */
export function clearRoundStatuses(unit: UnitToken): UnitToken {
  return {
    ...unit,
    fear: false,
    tempFearless: false,
    rooted: false,
    bonePrisoned: false,
    terrorFear: false,
    unyielding: false,
    slowPendingClear: false,
    assaultMarked: false,
    nullPulsed: false,
    counterattack: false,
    spectralStrike: false,
  }
}

/** Mark slow for consumption at end of this company activation. */
export function markSlowForActivation(unit: UnitToken): UnitToken {
  return {
    ...unit,
    slowPendingClear: !!unit.slow,
  }
}

/** Clear slow consumed at end of a company activation. */
export function clearConsumedSlow(unit: UnitToken): UnitToken {
  if (!unit.slowPendingClear) return unit
  return { ...unit, slow: false, slowPendingClear: false }
}

/** Back-fill status fields on older saves / partial tokens. */
export function normalizeUnitStatuses(unit: UnitToken): UnitToken {
  return {
    ...unit,
    rooted: unit.rooted ?? false,
    fear: unit.fear ?? false,
    slow: unit.slow ?? false,
    tempFearless: unit.tempFearless ?? false,
    unyielding: unit.unyielding ?? false,
    bonePrisoned: unit.bonePrisoned ?? false,
    terrorFear: unit.terrorFear ?? false,
    slowPendingClear: unit.slowPendingClear ?? false,
    assaultMarked: unit.assaultMarked ?? false,
    nullPulsed: unit.nullPulsed ?? false,
    counterattack: unit.counterattack ?? false,
    spectralStrike: unit.spectralStrike ?? false,
  }
}

export type UnitStatusPill = { key: string; label: string }

/** Human-readable active status labels for UI pills. */
export function unitStatusPills(unit: UnitToken): UnitStatusPill[] {
  const pills: UnitStatusPill[] = []
  if (unit.fear || unit.terrorFear) pills.push({ key: 'fear', label: 'Fear' })
  if (unit.slow) pills.push({ key: 'slow', label: 'Slow' })
  if (unit.rooted) pills.push({ key: 'rooted', label: 'Rooted' })
  if (unit.bonePrisoned) pills.push({ key: 'bonePrisoned', label: 'Bone Prison' })
  if (unit.tempFearless || hasUnitAbility(unit, 'Fearless')) {
    pills.push({ key: 'fearless', label: 'Fearless' })
  }
  if (unit.unyielding) pills.push({ key: 'unyielding', label: 'Unyielding' })
  if (unit.evadeActive) pills.push({ key: 'evade', label: 'Evade' })
  if ((unit.poisonTokens ?? 0) > 0) {
    pills.push({ key: 'poison', label: 'Poison' })
  }
  if (unit.assaultMarked) pills.push({ key: 'assaultMarked', label: 'Focused' })
  if (unit.nullPulsed) pills.push({ key: 'nullPulsed', label: 'Null Pulse' })
  if (unit.counterattack) pills.push({ key: 'counterattack', label: 'Counterattack' })
  if (unit.spectralStrike) pills.push({ key: 'spectralStrike', label: 'Spectral' })
  if (unit.frenzyAttackPending) pills.push({ key: 'frenzy', label: 'Frenzy attack' })
  if (
    (unit.kind === 'commander' && unit.attackedThisRound) ||
    (unit.kind !== 'commander' && unit.attackedThisTurn && !unit.frenzyAttackPending)
  ) {
    pills.push({ key: 'attacked', label: 'Attacked' })
  }
  return pills
}
