/**
 * Live board-hover readout: current stats + activation state for a unit token.
 */
import {
  effectiveDamage,
  formationDrillHitBonus,
  formationGuardMitigation,
  formationMarchBonus,
  terrainDamageBonus,
  terrainHardenBonus,
  terrainHitBonus,
  terrainMoveBonus,
  unitActiveTerrainEffects,
  unitHexTerrain,
  unitStatusPills,
  type GameState,
  type UnitToken,
} from '../../shared/index'

export type ActivationTone = 'active' | 'done' | 'ready' | 'na'

export type UnitActivationInfo = {
  label: string
  tone: ActivationTone
}

export function findCompanyOfficer(
  state: GameState,
  unit: UnitToken,
): UnitToken | null {
  if (unit.kind === 'officer') return unit
  if (unit.kind === 'commander') return null
  if (!unit.officerCardId) return null
  return (
    state.units.find(
      (u) =>
        u.kind === 'officer' &&
        u.seat === unit.seat &&
        u.cardId === unit.officerCardId,
    ) ?? null
  )
}

/** Whether this model / its company has activated (turn / round). */
export function unitActivationInfo(
  state: GameState,
  unit: UnitToken,
): UnitActivationInfo {
  if (state.phase !== 'Play') {
    return { label: 'Not in play phase', tone: 'na' }
  }

  if (unit.kind === 'commander') {
    if (state.commanderActivatedThisRound?.[unit.seat]) {
      return { label: 'Activated this round', tone: 'done' }
    }
    return { label: 'Not activated this round', tone: 'ready' }
  }

  const officer = findCompanyOfficer(state, unit)
  if (!officer) {
    return { label: 'No officer on field', tone: 'na' }
  }

  if (state.activeCompanyOfficerId === officer.id) {
    return { label: 'Company active now', tone: 'active' }
  }

  if (state.companiesActivatedThisRound?.[officer.id]) {
    return { label: 'Activated this round', tone: 'done' }
  }

  const turnOfficer = state.companyActivatedThisTurn?.[unit.seat]
  if (turnOfficer === officer.id) {
    return { label: 'Activated this turn', tone: 'done' }
  }
  if (turnOfficer && turnOfficer !== officer.id) {
    return { label: 'Not activated (other company this turn)', tone: 'ready' }
  }

  return { label: 'Not activated this turn', tone: 'ready' }
}

export type UnitLiveStats = {
  moveRemaining: number
  move: number
  toughnessCurrent: number | null
  toughness: number | null
  damage: number
  printedDamage: number | null
  range: number | null
  attackedThisTurn: boolean
  activation: UnitActivationInfo
  /** Company officer name for units; null for commanders / unknown. */
  officerName: string | null
  /** Temporary combat buffs (Move / Damage / Harden / …). */
  buffLabels: string[]
  /** Terrain / status debuffs shown alongside statuses. */
  debuffLabels: string[]
  /** Current hex terrain name for display. */
  terrainLabel: string | null
  /** Current hex terrain kind key (plains, forest, …). */
  terrainKind: string | null
  /** Terrain-only buff labels (for card tooltip). */
  terrainBuffLabels: string[]
  /** Status effects (Fear, Rooted, …). */
  statusLabels: string[]
}

/**
 * Active temporary / aura / terrain buffs that change combat or movement.
 * Numeric bonuses from multiple sources are combined (e.g. Formation + Favored).
 */
export function unitBuffLabels(state: GameState, unit: UnitToken): string[] {
  const terrain = unitActiveTerrainEffects(state, unit)
  const buffs: string[] = []

  const moveBonus =
    (unit.tempMove || 0) +
    formationMarchBonus(state, unit) +
    terrainMoveBonus(state, unit)
  if (moveBonus > 0) buffs.push(`+${moveBonus} Move`)
  if (moveBonus < 0) buffs.push(`${moveBonus} Move`)

  const damageBonus = (unit.tempDamage || 0) + terrainDamageBonus(state, unit)
  if (damageBonus > 0) buffs.push(`+${damageBonus} Damage`)
  if (damageBonus < 0) buffs.push(`${damageBonus} Damage`)

  const hitBonus =
    formationDrillHitBonus(state, unit) + terrainHitBonus(state, unit)
  if (hitBonus > 0) buffs.push(`+${hitBonus} Hit`)

  const harden = (unit.harden || 0) + terrainHardenBonus(state, unit)
  if (harden > 0) buffs.push(`Harden ${harden}`)

  if (formationGuardMitigation(state, unit) > 0) buffs.push('+1 Toughness')

  // Terrain-only qualitative buffs (numeric ones already folded above)
  for (const label of terrain.buffs) {
    if (
      label === '+1 Hit' ||
      label === '+1 Damage' ||
      label === '+1 Move' ||
      label === 'Harden 1'
    ) {
      continue
    }
    if (!buffs.includes(label)) buffs.push(label)
  }

  if ((unit.trampleLeftoverDamage ?? 0) > 0) {
    buffs.push(`Trample ${unit.trampleLeftoverDamage}`)
  }
  return buffs
}

export function unitDebuffLabels(state: GameState, unit: UnitToken): string[] {
  return unitActiveTerrainEffects(state, unit).debuffs
}

export function unitLiveStats(
  state: GameState,
  unit: UnitToken,
): UnitLiveStats {
  const printedDamage = unit.damage
  const damage = effectiveDamage(unit) + terrainDamageBonus(state, unit)
  const terrain = unitActiveTerrainEffects(state, unit)
  let officerName: string | null = null
  if (unit.kind === 'unit') {
    const officer = findCompanyOfficer(state, unit)
    if (officer) {
      officerName = officer.cardName
    } else if (unit.officerCardId) {
      officerName =
        state.cardCatalog?.[unit.officerCardId]?.name ?? unit.officerCardId
    }
  } else if (unit.kind === 'officer') {
    officerName = unit.cardName
  }
  return {
    moveRemaining: unit.moveRemaining,
    move:
      unit.move +
      (unit.tempMove || 0) +
      formationMarchBonus(state, unit) +
      terrainMoveBonus(state, unit),
    toughnessCurrent: unit.toughnessCurrent,
    toughness: unit.toughness,
    damage,
    printedDamage,
    range: unit.range,
    attackedThisTurn: !!unit.attackedThisTurn,
    activation: unitActivationInfo(state, unit),
    officerName,
    buffLabels: unitBuffLabels(state, unit),
    debuffLabels: terrain.debuffs,
    terrainLabel: terrain.terrainLabel,
    terrainKind: unitHexTerrain(state, unit),
    terrainBuffLabels: terrain.buffs,
    statusLabels: unitStatusPills(unit).map((p) => p.label),
  }
}
