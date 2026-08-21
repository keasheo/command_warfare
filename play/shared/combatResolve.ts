import { SCOUT_CR_EXTENSION } from './constants'
import { hexBehind, hexDistOddR, hexKey, inBounds, neighborsOddR, type OddR } from './hex'
import {
  FAVORED_TERRAIN_BONUS,
  desertBlocksEvade,
  favoredGrantsDamageBonus,
  favoredGrantsGuard,
  favoredGrantsHitBonus,
  favoredGrantsHardenBonus,
  favoredGrantsMoveBonus,
  forestRangedHitPenalty,
  mountainsDefenseHitPenalty,
  swampBlocksFlanking,
  unitHasTerrainBonus,
  volcanicBlocksBrace,
  type TerrainKind,
} from './terrainPieces'
import type { CardSnapshot } from './army'
import {
  canGainFear,
  unitHasFearPenalty,
} from './statusEffects'
import {
  formationDrillHitBonus,
  formationGuardMitigation,
} from './formation'
import type { GameState, UnitToken } from './types'
import { isMeleeSiegeWeapon } from './siege'

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
  if (ctx.defender.evadeActive && !desertBlocksEvade(terrainAt(ctx.state, ctx.defender))) {
    modifiers.push({ label: 'Evade', delta: 1 })
  }
  // Mountains Base
  if (
    mountainsDefenseHitPenalty(
      terrainAt(ctx.state, ctx.defender),
      terrainAt(ctx.state, ctx.attacker),
    )
  ) {
    modifiers.push({ label: 'Mountains', delta: 1 })
  }
  // Forest Base (ranged into Forest)
  {
    const defT = terrainAt(ctx.state, ctx.defender)
    const atkT = terrainAt(ctx.state, ctx.attacker)
    const forestFavored = unitHasTerrainBonus(
      unitRace(ctx.state, ctx.attacker),
      ctx.attacker.keywords,
      'forest',
      favoredTerrainFor(ctx.state, ctx.attacker),
    )
    if (forestRangedHitPenalty(defT, atkT, forestFavored, dist)) {
      modifiers.push({ label: 'Forest', delta: 1 })
    }
  }
  if (isFavoredTerrainHit(ctx)) {
    modifiers.push({ label: 'Favored', delta: -FAVORED_TERRAIN_BONUS.hit })
  }
  if (dist === 1 && isFlankingHit(ctx)) {
    modifiers.push({ label: 'Flanking', delta: -1 })
  }
  if (formationDrillHitBonus(ctx.state, ctx.attacker) > 0) {
    modifiers.push({ label: 'Formation Drill', delta: -1 })
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
  formationDrill?: boolean
}): HitNeedBreakdown {
  const baseNeed = baseHitNeedForDistance(input.distance)
  const modifiers: HitNeedModifier[] = []
  if (input.fearPenalty) modifiers.push({ label: 'Fear', delta: 1 })
  if (input.evadeActive) modifiers.push({ label: 'Evade', delta: 1 })
  if (input.favoredTerrainHit) {
    modifiers.push({ label: 'Favored', delta: -FAVORED_TERRAIN_BONUS.hit })
  }
  if (input.flanking) modifiers.push({ label: 'Flanking', delta: -1 })
  if (input.formationDrill) {
    modifiers.push({ label: 'Formation Drill', delta: -1 })
  }
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
  formationDrill: boolean
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
  overpenetrateLeftover: number
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

export function hasBlast(unit: UnitToken): boolean {
  return hasUnitAbility(unit, 'Blast')
}

export function hasOverpenetrate(unit: UnitToken): boolean {
  return hasUnitAbility(unit, 'Overpenetrate')
}

export function occupantAtHex(state: GameState, cell: OddR): UnitToken | null {
  return (
    state.units.find(
      (u) =>
        u.col === cell.col &&
        u.row === cell.row &&
        (u.kind === 'commander' || (u.toughnessCurrent ?? 0) > 0),
    ) ?? null
  )
}

export type BlastSplashHit = {
  defenderId: string
  defenderName: string
  col: number
  row: number
  dice: [number, number]
  roll: number
  hitNeed: number
  hit: boolean
  dealt: number
  killed: boolean
}

/** Enemies adjacent to the primary target (not the primary, not friendlies). */
export function blastSplashTargets(
  state: GameState,
  attacker: UnitToken,
  primary: UnitToken,
): UnitToken[] {
  if (!hasBlast(attacker)) return []
  const adj = new Set(
    neighborsOddR({ col: primary.col, row: primary.row }).map((h) =>
      hexKey(h.col, h.row),
    ),
  )
  return state.units.filter(
    (u) =>
      u.id !== primary.id &&
      u.id !== attacker.id &&
      u.seat !== attacker.seat &&
      (u.toughnessCurrent ?? 0) > 0 &&
      adj.has(hexKey(u.col, u.row)),
  )
}

/** Separate Hit roll vs one Blast splash enemy. Does not require attacker range. */
export function resolveBlastSplashHit(ctx: CombatContext): BlastSplashHit {
  const dist = hexDistOddR(ctx.attacker, ctx.defender)
  const hitNeed = hitRequirement(ctx, dist)
  const rng = ctx.rng ?? Math.random
  const dice = rollHitDice(rng)
  const roll = dice[0] + dice[1]
  const hit = roll >= hitNeed
  const raw = strikeDamage(ctx)
  if (!hit) {
    return {
      defenderId: ctx.defender.id,
      defenderName: ctx.defender.cardName,
      col: ctx.defender.col,
      row: ctx.defender.row,
      dice,
      roll,
      hitNeed,
      hit: false,
      dealt: 0,
      killed: false,
    }
  }
  const { dealt, unyieldingBlocked } = applyIncomingDamage(
    { state: ctx.state, defender: ctx.defender, attacker: ctx.attacker },
    raw,
  )
  const tough = ctx.defender.toughnessCurrent ?? 0
  const killed = !unyieldingBlocked && dealt > 0 && tough - dealt <= 0
  return {
    defenderId: ctx.defender.id,
    defenderName: ctx.defender.cardName,
    col: ctx.defender.col,
    row: ctx.defender.row,
    dice,
    roll,
    hitNeed,
    hit: true,
    dealt: unyieldingBlocked ? 0 : dealt,
    killed,
  }
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
  // TODO(damageTypes): wire damageTypeBonus(attackerTags, defenderTags) once matrix is filled.
  // Volcanic Favored: +1 Damage when attacking from Volcanic
  const atkTerrain = terrainAt(ctx.state, ctx.attacker)
  if (
    favoredGrantsDamageBonus(atkTerrain) &&
    unitHasTerrainBonus(
      unitRace(ctx.state, ctx.attacker),
      ctx.attacker.keywords,
      atkTerrain,
      favoredTerrainFor(ctx.state, ctx.attacker),
    )
  ) {
    dmg += FAVORED_TERRAIN_BONUS.damage
  }
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
  if (
    swampBlocksFlanking(
      terrainAt(ctx.state, ctx.defender),
      terrainAt(ctx.state, ctx.attacker),
    )
  ) {
    return false
  }
  return ctx.state.units.some(
    (m) =>
      m.seat === ctx.attacker.seat &&
      m.id !== ctx.attacker.id &&
      hexDistOddR(m, ctx.defender) === 1,
  )
}

function isFavoredTerrainHit(ctx: CombatContext): boolean {
  const terrain = terrainAt(ctx.state, ctx.attacker)
  if (!favoredGrantsHitBonus(terrain)) return false
  const race = unitRace(ctx.state, ctx.attacker)
  const favored = favoredTerrainFor(ctx.state, ctx.attacker)
  return unitHasTerrainBonus(race, ctx.attacker.keywords, terrain, favored)
}

function isMountainsFavoredHarden(ctx: DamageContext): boolean {
  const terrain = terrainAt(ctx.state, ctx.defender)
  if (!favoredGrantsHardenBonus(terrain)) return false
  const race = unitRace(ctx.state, ctx.defender)
  const favored = favoredTerrainFor(ctx.state, ctx.defender)
  return unitHasTerrainBonus(race, ctx.defender.keywords, terrain, favored)
}

/** Swamp Favored: Guard while in Swamp (for rules/UI; Disengage wiring uses this). */
export function unitHasTerrainGuard(state: GameState, unit: UnitToken): boolean {
  if (hasUnitAbility(unit, 'Guard')) return true
  const terrain = terrainAt(state, unit)
  if (!favoredGrantsGuard(terrain)) return false
  const race = unitRace(state, unit)
  const favored = favoredTerrainFor(state, unit)
  return unitHasTerrainBonus(race, unit.keywords, terrain, favored)
}

export function terrainBlocksEvade(state: GameState, unit: UnitToken): boolean {
  return desertBlocksEvade(terrainAt(state, unit))
}

export function terrainBlocksBrace(state: GameState, unit: UnitToken): boolean {
  return volcanicBlocksBrace(terrainAt(state, unit))
}

export function terrainMoveBonus(state: GameState, unit: UnitToken): number {
  const terrain = terrainAt(state, unit)
  if (!favoredGrantsMoveBonus(terrain)) return 0
  const race = unitRace(state, unit)
  const favored = favoredTerrainFor(state, unit)
  return unitHasTerrainBonus(race, unit.keywords, terrain, favored) ? 1 : 0
}

/** Terrain kind under this unit (defaults to plains). */
export function unitHexTerrain(state: GameState, unit: UnitToken): TerrainKind {
  return terrainAt(state, unit)
}

function unitHasFavoredOnHex(state: GameState, unit: UnitToken): boolean {
  const terrain = terrainAt(state, unit)
  return unitHasTerrainBonus(
    unitRace(state, unit),
    unit.keywords,
    terrain,
    favoredTerrainFor(state, unit),
  )
}

/** Favored plains/desert: +1 Hit while attacking from this hex. */
export function terrainHitBonus(state: GameState, unit: UnitToken): number {
  const terrain = terrainAt(state, unit)
  if (!favoredGrantsHitBonus(terrain)) return 0
  return unitHasFavoredOnHex(state, unit) ? FAVORED_TERRAIN_BONUS.hit : 0
}

/** Favored volcanic: +1 Damage while attacking from this hex. */
export function terrainDamageBonus(state: GameState, unit: UnitToken): number {
  const terrain = terrainAt(state, unit)
  if (!favoredGrantsDamageBonus(terrain)) return 0
  return unitHasFavoredOnHex(state, unit) ? FAVORED_TERRAIN_BONUS.damage : 0
}

/** Favored mountains: +1 Harden while occupying. */
export function terrainHardenBonus(state: GameState, unit: UnitToken): number {
  const terrain = terrainAt(state, unit)
  if (!favoredGrantsHardenBonus(terrain)) return 0
  return unitHasFavoredOnHex(state, unit) ? 1 : 0
}

const TERRAIN_LABEL: Record<TerrainKind, string> = {
  plains: 'Plains',
  forest: 'Forest',
  swamp: 'Swamp',
  desert: 'Desert',
  volcanic: 'Volcanic',
  mountains: 'Mountains',
  water: 'Water',
  wall: 'Wall',
}

/**
 * Active terrain buffs/debuffs for UI (hover / selected).
 * Matches combatResolve terrain Base + Favored rules.
 */
export function unitActiveTerrainEffects(
  state: GameState,
  unit: UnitToken,
): { buffs: string[]; debuffs: string[]; terrainLabel: string } {
  const terrain = terrainAt(state, unit)
  const favored = unitHasFavoredOnHex(state, unit)
  const buffs: string[] = []
  const debuffs: string[] = []

  if (favored) {
    if (favoredGrantsHitBonus(terrain)) buffs.push('+1 Hit')
    if (favoredGrantsDamageBonus(terrain)) buffs.push('+1 Damage')
    if (favoredGrantsHardenBonus(terrain)) buffs.push('Harden 1')
    if (favoredGrantsGuard(terrain)) buffs.push('Guard')
    if (favoredGrantsMoveBonus(terrain)) buffs.push('+1 Move')
    if (terrain === 'forest') buffs.push('Ignore Forest penalty')
  }

  // Base defensive cover (anyone on the hex)
  if (terrain === 'mountains') buffs.push('Mountains cover')
  if (terrain === 'forest') buffs.push('Forest cover')
  if (terrain === 'swamp') buffs.push('Blocks Flanking')

  // Base restrictions
  if (desertBlocksEvade(terrain)) debuffs.push('No Evade')
  if (volcanicBlocksBrace(terrain)) debuffs.push('No Brace')

  return {
    buffs,
    debuffs,
    terrainLabel: TERRAIN_LABEL[terrain] ?? terrain,
  }
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
  const piercing = !!(
    attacker &&
    (hasUnitAbility(attacker, 'Piercing') ||
      isMeleeSiegeWeapon(attacker, state.cardCatalog?.[attacker.cardId]))
  )

  // Harden sources stack: unit track (printed + grants) + Fortified hex + Mountains Favored.
  const unitHarden = Math.max(defender.harden || 0, hardenRankFromKeywords(defender))
  const fortifiedHarden = fortified ? 1 : 0
  const mountainsHarden = isMountainsFavoredHarden(ctx) ? 1 : 0
  const harden = unitHarden + fortifiedHarden + mountainsHarden

  if (harden > 0 && !piercing) {
    dmg = reduceDamageFloor(dmg, harden)
  }
  if (hasUnitAbility(defender, 'Defender') && !attacker?.spectralStrike) {
    dmg = reduceDamageFloor(dmg, 1)
  }
  const formationGuard = formationGuardMitigation(state, defender)
  if (formationGuard > 0) {
    dmg = reduceDamageFloor(dmg, formationGuard)
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
  const trampleCont = (attacker.trampleLeftoverDamage ?? 0) > 0
  const frenzyBonus = !!attacker.frenzyAttackPending
  if (attacker.kind === 'commander') {
    if (attacker.attackedThisRound && !trampleCont && !frenzyBonus) {
      return { ok: false, reason: 'Commander already attacked this round.' }
    }
  } else if (attacker.attackedThisTurn && !trampleCont && !frenzyBonus) {
    return { ok: false, reason: 'Already attacked this turn (1 attack per unit).' }
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
  const formationDrill = formationDrillHitBonus(ctx.state, ctx.attacker) > 0
  const evadeActive = !!ctx.defender.evadeActive
  const fearPenalty = unitHasFearPenalty(ctx.attacker)
  const fortifiedHex = isHexFortified(ctx.state, ctx.defender)
  const piercing =
    hasUnitAbility(ctx.attacker, 'Piercing') ||
    isMeleeSiegeWeapon(ctx.attacker, ctx.state.cardCatalog?.[ctx.attacker.cardId])
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
      formationDrill,
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
    formationDrill,
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
      overpenetrateLeftover: 0,
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
  const overpenetrateLeftover =
    killed && hasOverpenetrate(ctx.attacker) && !hasBlast(ctx.attacker)
      ? trampleLeftoverDamage(raw, defenderHpBefore)
      : 0

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
    overpenetrateLeftover,
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

export function applyBlastSplashToState(
  state: GameState,
  splash: BlastSplashHit,
): GameState {
  if (!splash.hit || splash.dealt <= 0) return state
  return {
    ...state,
    units: state.units.map((u) => {
      if (u.id !== splash.defenderId) return u
      if (u.toughnessCurrent == null) return u
      return {
        ...u,
        toughnessCurrent: Math.max(0, u.toughnessCurrent - splash.dealt),
      }
    }),
  }
}

/** Bolt continues behind a destroyed primary; leftover Damage, new Hit rolls. */
export function applyOverpenetrateChain(
  state: GameState,
  attacker: UnitToken,
  primary: UnitToken,
  leftover: number,
): { state: GameState; hits: BlastSplashHit[] } {
  const hits: BlastSplashHit[] = []
  if (!hasOverpenetrate(attacker) || leftover <= 0) return { state, hits }
  const origin: OddR = { col: attacker.col, row: attacker.row }
  let next = state
  let through: OddR = { col: primary.col, row: primary.row }
  let dmg = leftover
  const liveAtk = () => next.units.find((u) => u.id === attacker.id) ?? attacker

  for (let step = 0; step < next.boardSize && dmg > 0; step++) {
    const behind = hexBehind(origin, through)
    if (!behind || !inBounds(behind, next.boardSize)) break
    const occ = occupantAtHex(next, behind)
    if (!occ) {
      through = behind
      continue
    }
    if (occ.seat === attacker.seat || occ.kind === 'commander') break
    const hpBefore = occ.toughnessCurrent ?? 0
    if (hpBefore <= 0) {
      through = behind
      continue
    }
    const splash = resolveBlastSplashHit({
      state: next,
      attacker: liveAtk(),
      defender: occ,
      strikeDamageOverride: dmg,
    })
    hits.push(splash)
    if (!splash.hit || splash.dealt <= 0) break
    next = applyBlastSplashToState(next, splash)
    if (!splash.killed) break
    dmg = trampleLeftoverDamage(dmg, hpBefore)
    through = { col: occ.col, row: occ.row }
  }
  return { state: next, hits }
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
