/** Card snapshot used for army lists (subset of Command Warfare card fields). */

import {
  ARMY_UNUSED_UV_MAX,
  DEPLOY_UV_MAX,
  maxArmyCopiesForRarity,
  RESERVE_UV_MAX,
} from './constants'

/** Battle-lock bucket for a company (officer + units). Commander always deploys. */
export type BattleBucket = 'deploy' | 'reserve' | 'unused'

/** Officer card id → battle bucket at lock time. */
export type BattleLoadout = Record<string, BattleBucket>

export type CardSnapshot = {
  id: string
  name: string
  cardType: 'Commander' | 'Officer' | 'Unit' | string
  rarity: string | null
  unique: boolean
  race: string | null
  uv: number | null
  move: number | null
  damage: number | null
  range: number | null
  toughness: number | null
  companyCapacity: number | null
  commandRadius: number | null
  /** Officer printed Company AP. */
  companyAp: number | null
  /** Commander printed AP generation. */
  apGeneration: number | null
  /** Commander printed CC generation. */
  ccGeneration: number | null
  /** Favored terrain for combat bonuses (plains, forest, swamp, volcanic, hills, desert). */
  favoredTerrain?: string | null
  /** Optional keywords for movement / combat (Flying, Amphibious, …). */
  keywords?: string[] | null
  /** Printed ability names (regular slots). */
  abilities?: string[] | null
  /** Commander ultimate ability name. */
  ultimate?: string | null
}

export type ArmyUnitEntry = {
  cardId: string
  /** Copies of this unit under this officer */
  count: number
}

export type ArmyCompany = {
  officerCardId: string
  units: ArmyUnitEntry[]
}

export type ArmyList = {
  commanderCardId: string
  companies: ArmyCompany[]
}

export type ResolvedArmyUnit = {
  card: CardSnapshot
  officerCardId: string
}

export type ResolvedArmy = {
  commander: CardSnapshot
  companies: Array<{
    officer: CardSnapshot
    units: CardSnapshot[] // expanded by count
  }>
  totalUv: number
}

export type CardLookup = Map<string, CardSnapshot>

export function armyTotalUv(army: ResolvedArmy): number {
  let uv = army.commander.uv ?? 0
  for (const c of army.companies) {
    uv += c.officer.uv ?? 0
    for (const u of c.units) uv += u.uv ?? 0
  }
  return uv
}

/** How many copies of a card id appear in an army list (commander + officers + units). */
export function countCardCopiesInList(list: ArmyList, cardId: string): number {
  let n = 0
  if (list.commanderCardId === cardId) n += 1
  for (const co of list.companies) {
    if (co.officerCardId === cardId) n += 1
    for (const entry of co.units) {
      if (entry.cardId === cardId) n += entry.count
    }
  }
  return n
}

export function copyLimitForCard(card: CardSnapshot): number {
  return maxArmyCopiesForRarity(card.rarity, card.unique)
}

export function resolveArmy(
  list: ArmyList,
  cards: CardLookup,
  opts: { enforceCommanderRace?: boolean } = {},
): { ok: true; army: ResolvedArmy } | { ok: false; error: string } {
  const enforceRace = opts.enforceCommanderRace !== false
  const commander = cards.get(list.commanderCardId)
  if (!commander || commander.cardType !== 'Commander') {
    return { ok: false, error: 'Army needs a valid Commander.' }
  }
  if (!list.companies.length) {
    return { ok: false, error: 'Army needs at least one Officer company.' }
  }

  const copyCounts = new Map<string, number>()
  const bump = (card: CardSnapshot, add: number) => {
    const next = (copyCounts.get(card.id) ?? 0) + add
    const max = copyLimitForCard(card)
    if (next > max) {
      return {
        ok: false as const,
        error: `${card.name} (${card.rarity || 'Common'}${card.unique ? ', Unique' : ''}) is limited to ${max} per army (have ${next}).`,
      }
    }
    copyCounts.set(card.id, next)
    return { ok: true as const }
  }

  {
    const lim = bump(commander, 1)
    if (!lim.ok) return lim
  }

  const companies: ResolvedArmy['companies'] = []
  for (const co of list.companies) {
    const officer = cards.get(co.officerCardId)
    if (!officer || officer.cardType !== 'Officer') {
      return { ok: false, error: `Invalid officer ${co.officerCardId}.` }
    }
    {
      const lim = bump(officer, 1)
      if (!lim.ok) return lim
    }
    if (
      enforceRace &&
      commander.race &&
      officer.race &&
      officer.race !== commander.race
    ) {
      return {
        ok: false,
        error: `Officer ${officer.name} must match commander race (${commander.race}).`,
      }
    }
    const cap = officer.companyCapacity ?? 0
    if (cap <= 0) {
      return { ok: false, error: `Officer ${officer.name} has no company capacity.` }
    }
    const units: CardSnapshot[] = []
    let companyUv = 0
    for (const entry of co.units) {
      if (entry.count < 1) continue
      const unit = cards.get(entry.cardId)
      if (!unit || unit.cardType !== 'Unit') {
        return { ok: false, error: `Invalid unit ${entry.cardId}.` }
      }
      {
        const lim = bump(unit, entry.count)
        if (!lim.ok) return lim
      }
      if (
        enforceRace &&
        commander.race &&
        unit.race &&
        unit.race !== commander.race
      ) {
        return {
          ok: false,
          error: `Unit ${unit.name} must match commander race (${commander.race}).`,
        }
      }
      const uUv = unit.uv ?? 0
      companyUv += uUv * entry.count
      for (let i = 0; i < entry.count; i++) units.push(unit)
    }
    if (companyUv > cap) {
      return {
        ok: false,
        error: `${officer.name} company UV ${companyUv} exceeds capacity ${cap}.`,
      }
    }
    if (!units.length) {
      return { ok: false, error: `${officer.name} needs at least one unit.` }
    }
    companies.push({ officer, units })
  }

  const army: ResolvedArmy = { commander, companies, totalUv: 0 }
  army.totalUv = armyTotalUv(army)
  return { ok: true, army }
}

export function validateArmyUv(
  army: ResolvedArmy,
  maxUv: number,
): { ok: true } | { ok: false; error: string } {
  if (army.totalUv > maxUv) {
    return { ok: false, error: `Army UV ${army.totalUv} exceeds max ${maxUv}.` }
  }
  if (army.totalUv < 1) {
    return { ok: false, error: 'Army UV must be at least 1.' }
  }
  return { ok: true }
}

export type BattleLoadoutTotals = {
  deploy: number
  reserve: number
  unused: number
}

/** UV for one resolved company (officer + all unit copies). */
export function resolvedCompanyUv(
  co: ResolvedArmy['companies'][number],
): number {
  let uv = co.officer.uv ?? 0
  for (const u of co.units) uv += u.uv ?? 0
  return uv
}

export function defaultBattleLoadout(army: ResolvedArmy): BattleLoadout {
  const loadout: BattleLoadout = {}
  for (const co of army.companies) {
    loadout[co.officer.id] = 'deploy'
  }
  return loadout
}

export function battleLoadoutTotals(
  army: ResolvedArmy,
  loadout: BattleLoadout,
): BattleLoadoutTotals {
  const totals: BattleLoadoutTotals = { deploy: 0, reserve: 0, unused: 0 }
  for (const co of army.companies) {
    const bucket = loadout[co.officer.id]
    if (!bucket) continue
    totals[bucket] += resolvedCompanyUv(co)
  }
  return totals
}

export function validateBattleLoadout(
  army: ResolvedArmy,
  loadout: BattleLoadout,
): { ok: true; totals: BattleLoadoutTotals } | { ok: false; error: string } {
  for (const co of army.companies) {
    const bucket = loadout[co.officer.id]
    if (!bucket) {
      return {
        ok: false,
        error: `Assign ${co.officer.name} to Deploy, Reserve, or Unused.`,
      }
    }
    if (bucket !== 'deploy' && bucket !== 'reserve' && bucket !== 'unused') {
      return { ok: false, error: `Invalid battle bucket for ${co.officer.name}.` }
    }
  }

  for (const officerId of Object.keys(loadout)) {
    if (!army.companies.some((co) => co.officer.id === officerId)) {
      return { ok: false, error: 'Battle loadout references an unknown officer.' }
    }
  }

  const totals = battleLoadoutTotals(army, loadout)
  if (totals.deploy > DEPLOY_UV_MAX) {
    return {
      ok: false,
      error: `Deploy UV ${totals.deploy} exceeds max ${DEPLOY_UV_MAX}.`,
    }
  }
  if (totals.reserve > RESERVE_UV_MAX) {
    return {
      ok: false,
      error: `Reserve UV ${totals.reserve} exceeds max ${RESERVE_UV_MAX}.`,
    }
  }
  if (totals.unused > ARMY_UNUSED_UV_MAX) {
    return {
      ok: false,
      error: `Unused UV ${totals.unused} exceeds max ${ARMY_UNUSED_UV_MAX}.`,
    }
  }

  const assigned =
    totals.deploy + totals.reserve + totals.unused
  const companyUv = army.companies.reduce((s, co) => s + resolvedCompanyUv(co), 0)
  if (assigned !== companyUv) {
    return { ok: false, error: 'Battle loadout must cover every company exactly once.' }
  }

  return { ok: true, totals }
}

/** Flatten army companies in a battle bucket into deploy queue items (officers then units). */
export function deployQueueFromArmy(
  army: ResolvedArmy,
  loadout: BattleLoadout,
  bucket: BattleBucket = 'deploy',
): Array<{
  kind: 'officer' | 'unit'
  card: CardSnapshot
  officerCardId: string
}> {
  const q: Array<{ kind: 'officer' | 'unit'; card: CardSnapshot; officerCardId: string }> =
    []
  for (const co of army.companies) {
    if (loadout[co.officer.id] !== bucket) continue
    q.push({ kind: 'officer', card: co.officer, officerCardId: co.officer.id })
    for (const u of co.units) {
      q.push({ kind: 'unit', card: u, officerCardId: co.officer.id })
    }
  }
  return q
}
