import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CardLookup, CardSnapshot } from '../shared/army.ts'
import type { AbilityDef } from '../shared/abilityCast.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../../data/command-warfare.sqlite')

let db: Database.Database | null = null

function getDb(): Database.Database | null {
  if (db) return db
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
    return db
  } catch {
    return null
  }
}

export function loadCardSnapshots(ids: string[]): CardLookup {
  const map: CardLookup = new Map()
  const database = getDb()
  if (!database) return map
  const rows = (
    ids.length
      ? database
          .prepare(
            `SELECT id, name, card_type, rarity, unique_flag, race, uv, move, damage, range_value, toughness,
              company_capacity, company_unit_cap, command_radius, company_ap, ap_generation, cc_generation, favored_terrain,
              primary_type, secondary_type, flavor_text,
              keywords_json, abilities_json, ultimate
       FROM cards WHERE id IN (${[...new Set(ids)].map(() => '?').join(',')})`,
          )
          .all(...[...new Set(ids)])
      : database
          .prepare(
            `SELECT id, name, card_type, rarity, unique_flag, race, uv, move, damage, range_value, toughness,
              company_capacity, company_unit_cap, command_radius, company_ap, ap_generation, cc_generation, favored_terrain,
              primary_type, secondary_type, flavor_text,
              keywords_json, abilities_json, ultimate
       FROM cards`,
          )
          .all()
  ) as Array<{
    id: string
    name: string
    card_type: string
    rarity: string | null
    unique_flag: number | null
    race: string | null
    uv: number | null
    move: number | null
    damage: number | null
    range_value: number | null
    toughness: number | null
    company_capacity: number | null
    company_unit_cap: number | null
    command_radius: number | null
    company_ap: number | null
    ap_generation: number | null
    cc_generation: number | null
    favored_terrain: string | null
    primary_type: string | null
    secondary_type: string | null
    flavor_text: string | null
    keywords_json: string | null
    abilities_json: string | null
    ultimate: string | null
  }>
  for (const row of rows) {
    let keywords: string[] = []
    let abilities: string[] = []
    try {
      keywords = JSON.parse(row.keywords_json || '[]')
    } catch {
      keywords = []
    }
    try {
      abilities = JSON.parse(row.abilities_json || '[]')
    } catch {
      abilities = []
    }
    const snap: CardSnapshot = {
      id: row.id,
      name: row.name,
      cardType: row.card_type,
      rarity: row.rarity,
      unique: Boolean(row.unique_flag),
      race: row.race,
      uv: row.uv,
      move: row.move,
      damage: row.damage,
      range: row.range_value,
      toughness: row.toughness,
      companyCapacity: row.company_capacity,
      companyUnitCap: row.company_unit_cap ?? null,
      commandRadius: row.command_radius,
      companyAp: row.company_ap,
      apGeneration: row.ap_generation,
      ccGeneration: row.cc_generation,
      favoredTerrain: row.favored_terrain,
      primaryType: row.primary_type,
      secondaryType: row.secondary_type,
      flavorText: row.flavor_text,
      keywords,
      abilities,
      ultimate: row.ultimate,
    }
    map.set(snap.id, snap)
  }
  return map
}

/** Load ability definitions for the given names (or all if empty). */
export function loadAbilityDefs(names?: string[]): Record<string, AbilityDef> {
  const database = getDb()
  const out: Record<string, AbilityDef> = {}
  if (!database) return out
  const rows = (
    names?.length
      ? database
          .prepare(
            `SELECT name, ability_type, cost, cost_amount, cost_resource, description, used_by, cooldown
             FROM abilities WHERE name IN (${names.map(() => '?').join(',')})`,
          )
          .all(...[...new Set(names)])
      : database
          .prepare(
            `SELECT name, ability_type, cost, cost_amount, cost_resource, description, used_by, cooldown
             FROM abilities`,
          )
          .all()
  ) as Array<{
    name: string
    ability_type: string | null
    cost: string | null
    cost_amount: number | null
    cost_resource: string | null
    description: string | null
    used_by: string | null
    cooldown: number | null
  }>
  for (const row of rows) {
    out[row.name] = {
      name: row.name,
      type: row.ability_type,
      cost: row.cost,
      costAmount: row.cost_amount,
      costResource: row.cost_resource,
      description: row.description,
      usedBy: row.used_by,
      cooldown: row.cooldown,
    }
  }
  return out
}

export function armyCardIds(army: {
  commanderCardId: string
  companies: Array<{ officerCardId: string; units: Array<{ cardId: string }> }>
}): string[] {
  const ids = [army.commanderCardId]
  for (const c of army.companies) {
    ids.push(c.officerCardId)
    for (const u of c.units) ids.push(u.cardId)
  }
  return ids
}

export function abilityNamesFromCards(cards: CardLookup): string[] {
  const names = new Set<string>()
  for (const c of cards.values()) {
    for (const n of c.abilities ?? []) if (n) names.add(n)
    if (c.ultimate) names.add(c.ultimate)
  }
  return [...names]
}
