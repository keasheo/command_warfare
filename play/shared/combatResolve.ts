import { SCOUT_CR_EXTENSION } from './constants'
import { hexDistOddR, hexKey, type OddR } from './hex'
import {
  FAVORED_TERRAIN_BONUS,
  unitHasTerrainBonus,
  type TerrainKind,
} from './terrainPieces'
import type { CardSnapshot } from './army'
import {
  canGainFear,
  unitHasFearPenalty,
} from './statusEffects'
import type { GameState, UnitToken } from './types'

/** To-hit by hex distance (2d6 sum): adjacent 7+, +1 per hex out (cap 10+). */
const HIT_NEED: Record<number, number> = { 1: 7, 2: 8, 3: 9, 4: 10 }
const HIT_NEED_MIN = 5
const HIT_NEED_MAX = 11

export function rollHitDice(rng: () => number = Math.random): [number, number] {
  return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)]
}

export function rollHitSum(rng: () => number = Math.random): number {
  const [a, b] = rollHitDice(rng)
  return a + b
}

export type HitNeedModifier = {
  label: string
  /** Positive = harder to hit; negative = easier. */
  delta: number
}

export type HitNeedBreakdown = {
  baseNeed: number
  modifiers: HitNeedModifier[]
  finalNeed: number
}

export function baseHitNeedForDistance(dist: number): number {
  return HIT_NEED[dist] ?? HIT_NEED_MAX
}

export function buildHitNeedBreakdown(
  ctx: CombatContext,
  dist: number,
): HitNeedBreakdown {
  const baseNeed = baseHitNeedForDistance(dist)
  const modifiers: HitNeedModifier[] = []
  if (unitHasFearPenalty(ctx.attacker)) {
    modifiers.push({ label: 'Fear', delta: 1 })
  }
  if (ctx.defender.evadeActive) {
    modifiers.push({ label: 'Evade', delta: 1 })
  }
  if (isFavoredTerrainHit(ctx)) {
    modifiers.push({ label: 'Favored', delta: -FAVORED_TERRAIN_BONUS.hit })
  }
  if (dist === 1 && isFlankingHit(ctx)) {
    modifiers.push({ label: 'Flanking', delta: -1 })
  }
  const raw = baseNeed + modifiers.reduce((sum, m) => sum + m.delta, 0)
  const finalNeed = Math.max(HIT_NEED_MIN, Math.min(HIT_NEED_MAX, raw))
  return { baseNeed, modifiers, finalNeed }
}

/** Reconstruct breakdown from stored attack flags (preview or last result). */
export function hitNeedBreakdownFromFlags(input: {
  distance: number
  hitNeed: number
  fearPenalty?: boolean
  evadeActive?: boolean
  favoredTerrainHit?: boolean
  flanking?: boolean
}): HitNeedBreakdown {
  const baseNeed = baseHitNeedForDistance(input.distance)
  const modifiers: HitNeedModifier[] = []
  if (input.fearPenalty) modifiers.push({ label: 'Fear', delta: 1 })
  if (input.evadeActive) modifiers.push({ label: 'Evade', delta: 1 })
  if (input.favoredTerrainHit) {
    modifiers.push({ label: 'Favored', delta: -FAVORED_TERRAIN_BONUS.hit })
  }
  if (input.flanking) modifiers.push({ label: 'Flanking', delta: -1 })
  return { baseNeed, modifiers, finalNeed: input.hitNeed }
}

export type CombatContext = {
  state: GameState
  attacker: UnitToken
  defender: UnitToken
  /** Trample continuation damage (overrides printed Damage + temp). */
  strikeDamageOverride?: number
  rng?: () => number
}

export type AttackPreview = {
  legal: boolean
  reason?: string
  distance: number
  hitNeed: number
  rawDamage: number
  flanking: boolean
  favoredTerrainHit: boolean
  evadeActive: boolean
  fearPenalty: boolean
  fortifiedHex: boolean
  piercing: boolean
  trampleStrike: boolean
}

export type AttackResult = AttackPreview & {
  dice: [number, number]
  roll: number
  hit: boolean
  mitigated: number
  dealt: number
  killed: boolean
  poisonApplied: boolean
  fearApplied: boolean
  slowApplied: boolean
  unyieldingBlocked: boolean
  trampleLeftover: number
  trampleEligible: boolean
}

export function hasUnitAbility(unit: UnitToken, name: string): boolean {
  const needle = name.toLowerCase()
  if ((unit.abilities ?? []).some((a) => a.toLowerCase() === needle)) return true
  if (unit.ultimate?.toLowerCase() === needle) return true
  return (unit.keywords ?? []).some(
    (k) => k.toLowerCase() === needle || k.toLowerCase().startsWith(`${needle} `),
  )
}

export function hasScoutAbility(unit: UnitToken): boolean {
  return hasUnitAbility(unit, 'Scout')
}

export function hasTrample(unit: UnitToken): boolean {
  return hasUnitAbility(unit, 'Trample')
}

export function hardenRankFromKeywords(unit: UnitToken): number {
  let best = 0
  for (const k of unit.keywords ?? []) {
    const m = /^Harden (\d+)$/.exec(String(k))
    if (m) best = Math.max(best, Number(m[1]))
  }
  return best
}

export function isHexFortified(state: GameState, cell: OddR): boolean {
  return !!state.fortifiedHexes?.[hexKey(cell.col, cell.row)]
}

function catalogCard(state: GameState, cardId: string): CardSnapshot | undefined {
  return state.cardCatalog?.[cardId]
}

function unitRace(state: GameState, unit: UnitToken): string | null {
  return catalogCard(state, unit.cardId)?.race ?? null
}

function favoredTerrainFor(
  state: GameState,
  unit: UnitToken,
): string | null | undefined {
  return catalogCard(state, unit.cardId)?.favoredTerrain
}

function terrainAt(state: GameState, cell: OddR): TerrainKind {
  const key = hexKey(cell.col, cell.row)
  return (state.terrain?.[key] ?? 'plains') as TerrainKind
}

export function effectiveRange(unit: UnitToken): number {
  return Math.max(1, unit.range ?? 1)
}

export function effectiveDamage(unit: UnitToken): number {
  const base = unit.damage ?? 0
  return Math.max(0, base + (unit.tempDamage || 0))
}

export function strikeDamage(ctx: CombatContext): number {
  if (ctx.strikeDamageOverride != null && ctx.strikeDamageOverride > 0) {
    return ctx.strikeDamageOverride
  }
  let dmg = effectiveDamage(ctx.attacker)
  if (ctx.defender.assaultMarked) dmg += 1
  return dmg
}

export function canTarget(attacker: UnitToken, defender: UnitToken, dist: number): boolean {
  const defenderFlying = hasUnitAbility(defender, 'Flying')
  if (defenderFlying && dist <= 1) {
    return (
      hasUnitAbility(attacker, 'Reach') || hasUnitAbility(attacker, 'Flying')
    )
  }
  return true
}

function isFlankingHit(ctx: CombatContext): boolean {
  if (!hasUnitAbility(ctx.attacker, 'Flanking')) return false
  return ctx.state.units.some(
    (m) =>
      m.seat === ctx.attacker.seat &&
      m.id !== ctx.attacker.id &&
      hexDistOddR(m, ctx.defender) === 1,
  )
}

function isFavoredTerrainHit(ctx: CombatContext): boolean {
  const terrain = terrainAt(ctx.state, ctx.attacker)
  const race = unitRace(ctx.state, ctx.attacker)
  const favored = favoredTerrainFor(ctx.state, ctx.attacker)
  return unitHasTerrainBonus(race, ctx.attacker.keywords, terrain, favored)
}

export function hitRequirement(ctx: CombatContext, dist: number): number {
  return buildHitNeedBreakdown(ctx, dist).finalNeed
}

function reduceDamageFloor(dmg: number, amount: number): number {
  if (dmg <= 0) return 0
  return Math.max(1, dmg - amount)
}

export type DamageContext = {
  state: GameState
  defender: UnitToken
  attacker?: UnitToken
}

export function applyIncomingDamage(
  ctx: DamageContext,
  raw: number,
): {
  dealt: number
  mitigated: number
  fortified: boolean
  piercing: boolean
  unyieldingBlocked: boolean
} {
  const { defender, attacker, state } = ctx
  if (defender.unyielding && raw > 0) {
    return {
      dealt: 0,
      mitigated: raw,
      fortified: false,
      piercing: false,
      unyieldingBlocked: true,
    }
  }
  let dmg = Math.max(0, raw)
  const before = dmg
  const fortified = isHexFortified(state, defender)
  const piercing = !!(attacker && hasUnitAbility(attacker, 'Piercing'))

  const printedHarden = Math.max(defender.harden || 0, hardenRankFromKeywords(defender))
  let harden = printedHarden
  if (fortified) harden = Math.max(harden, 1)

  if (harden > 0 && !piercing) {
    dmg = reduceDamageFloor(dmg, harden)
  }
  if (hasUnitAbility(defender, 'Defender') && !attacker?.spectralStrike) {
    dmg = reduceDamageFloor(dmg, 1)
  }
  if (raw > 0 && dmg > 0) dmg = Math.max(1, dmg)

  return {
    dealt: dmg,
    mitigated: Math.max(0, before - dmg),
    fortified,
    piercing,
    unyieldingBlocked: false,
  }
}

/** Leftover Trample damage after killing a unit (sim: max(0, strikeDmg - hpBefore)). */
export function trampleLeftoverDamage(
  strikeDamageAmount: number,
  defenderHpBefore: number,
): number {
  return Math.max(0, strikeDamageAmount - defenderHpBefore)
}

export function validateAttack(
  ctx: CombatContext,
): { ok: true } | { ok: false; reason: string } {
  const { attacker, defender } = ctx
  if (attacker.seat === defender.seat) {
    return { ok: false, reason: 'Cannot attack allies.' }
  }
  if (defender.kind === 'commander') {
    return { ok: false, reason: 'Commander toughness is not tracked yet.' }
  }
  if (attacker.bonePrisoned) {
    return { ok: false, reason: 'Bone Prison — cannot attack this round.' }
  }
  const dmg = strikeDamage(ctx)
  if (dmg <= 0) {
    return { ok: false, reason: 'Attacker has no Damage.' }
  }
  const dist = hexDistOddR(attacker, defender)
  if (dist > effectiveRange(attacker)) {
    return { ok: false, reason: `Out of range (${dist} > ${effectiveRange(attacker)}).` }
  }
  if (!canTarget(attacker, defender, dist)) {
    return {
      ok: false,
      reason: 'Cannot target Flying in melee without Reach or Flying.',
    }
  }
  if (defender.toughnessCurrent == null) {
    return { ok: false, reason: 'Target has no Toughness.' }
  }
  return { ok: true }
}

export function previewAttack(ctx: CombatContext): AttackPreview {
  const dist = hexDistOddR(ctx.attacker, ctx.defender)
  const flanking = dist === 1 && isFlankingHit(ctx)
  const favoredTerrainHit = isFavoredTerrainHit(ctx)
  const evadeActive = !!ctx.defender.evadeActive
  const fearPenalty = unitHasFearPenalty(ctx.attacker)
  const fortifiedHex = isHexFortified(ctx.state, ctx.defender)
  const piercing = hasUnitAbility(ctx.attacker, 'Piercing')
  const trampleStrike = ctx.strikeDamageOverride != null && ctx.strikeDamageOverride > 0
  const check = validateAttack(ctx)
  if (!check.ok) {
    return {
      legal: false,
      reason: check.reason,
      distance: dist,
      hitNeed: 0,
      rawDamage: strikeDamage(ctx),
      flanking,
      favoredTerrainHit,
      evadeActive,
      fearPenalty,
      fortifiedHex,
      piercing,
      trampleStrike,
    }
  }
  return {
    legal: true,
    distance: dist,
    hitNeed: hitRequirement(ctx, dist),
    rawDamage: strikeDamage(ctx),
    flanking,
    favoredTerrainHit,
    evadeActive,
    fearPenalty,
    fortifiedHex,
    piercing,
    trampleStrike,
  }
}

export function resolveAttack(ctx: CombatContext): AttackResult {
  const preview = previewAttack(ctx)
  if (!preview.legal) {
    throw new Error(preview.reason ?? 'Illegal attack')
  }
  const rng = ctx.rng ?? Math.random
  const dice = rollHitDice(rng)
  const roll = dice[0] + dice[1]
  const dist = preview.distance
  const raw = preview.rawDamage
  const defenderHpBefore = ctx.defender.toughnessCurrent ?? 0

  if (roll < preview.hitNeed) {
    return {
      ...preview,
      dice,
      roll,
      hit: false,
      mitigated: 0,
      dealt: 0,
      killed: false,
      poisonApplied: false,
      fearApplied: false,
      slowApplied: false,
      unyieldingBlocked: false,
      trampleLeftover: 0,
      trampleEligible: false,
    }
  }

  const { dealt, mitigated, unyieldingBlocked } = applyIncomingDamage(
    { state: ctx.state, defender: ctx.defender, attacker: ctx.attacker },
    raw,
  )
  const tough = ctx.defender.toughnessCurrent ?? 0
  const killed = !unyieldingBlocked && dealt > 0 && tough - dealt <= 0
  const poisonOnHit =
    !unyieldingBlocked &&
    dealt > 0 &&
    !killed &&
    hasUnitAbility(ctx.attacker, 'Poison') &&
    (ctx.defender.poisonTokens ?? 0) < 1
  const fearOnHit =
    !unyieldingBlocked &&
    dealt > 0 &&
    !killed &&
    canGainFear(ctx.defender) &&
    (hasUnitAbility(ctx.attacker, 'Fear') || ctx.attacker.terrorFear)
  const slowOnHit =
    !unyieldingBlocked &&
    dealt > 0 &&
    !killed &&
    ctx.attacker.kind === 'unit' &&
    hasUnitAbility(ctx.attacker, 'Slow') &&
    ctx.attacker.seat !== ctx.defender.seat

  const trampleLeftover =
    killed && hasTrample(ctx.attacker) && dist === 1
      ? trampleLeftoverDamage(raw, defenderHpBefore)
      : 0
  const trampleEligible =
    killed && hasTrample(ctx.attacker) && dist === 1

  return {
    ...preview,
    dice,
    roll,
    hit: true,
    mitigated,
    dealt,
    killed,
    poisonApplied: poisonOnHit,
    fearApplied: fearOnHit,
    slowApplied: slowOnHit,
    unyieldingBlocked,
    trampleLeftover,
    trampleEligible,
  }
}

/** Whether a unit is inside an officer's CR (Scout extends by SCOUT_CR_EXTENSION). */
export function unitInOfficerRadius(
  unit: OddR,
  officer: OddR,
  radius: number,
  unitToken?: UnitToken | null,
): boolean {
  const dist = hexDistOddR(unit, officer)
  if (dist <= radius) return true
  if (unitToken && hasScoutAbility(unitToken) && dist <= radius + SCOUT_CR_EXTENSION) {
    return true
  }
  return false
}

/** Effective CR for display / legality for a specific unit (Scout extension). */
export function effectiveRadiusForUnit(
  baseRadius: number,
  unit?: UnitToken | null,
): number {
  if (unit && hasScoutAbility(unit)) return baseRadius + SCOUT_CR_EXTENSION
  return baseRadius
}

export function applyAttackResultToState(
  state: GameState,
  defenderId: string,
  attackerId: string,
  result: AttackResult,
): GameState {
  if (!result.hit) return state

  return {
    ...state,
    units: state.units.map((u) => {
      if (u.id === defenderId) {
        if (result.unyieldingBlocked) {
          return { ...u, unyielding: false }
        }
        if (!result.dealt || result.dealt <= 0) return u
        if (u.toughnessCurrent == null) return u
        const nextTough = Math.max(0, u.toughnessCurrent - result.dealt)
        const updated: UnitToken = { ...u, toughnessCurrent: nextTough }
        if (result.poisonApplied && nextTough > 0) {
          updated.poisonTokens = Math.min(1, (u.poisonTokens ?? 0) + 1)
        }
        if (result.fearApplied && nextTough > 0) {
          updated.fear = true
        }
        if (result.slowApplied && nextTough > 0) {
          updated.slow = true
        }
        return updated
      }
      if (u.id === attackerId && result.unyieldingBlocked) {
        return u
      }
      return u
    }),
  }
}
