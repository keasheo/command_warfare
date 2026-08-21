/**
 * Generate data/quick-pick-armies.json — one preset army per commander.
 * Run: npx tsx play/scripts/generateQuickPickArmies.mjs
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  copyLimitForCard,
  resolveArmy,
  type ArmyCompany,
  type CardSnapshot,
} from '../shared/army.ts'
import { ARMY_UV_MAX } from '../shared/constants.ts'
import { namedListFromArmy } from '../shared/armyFile.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DB_PATH = path.join(ROOT, 'data/command-warfare.sqlite')
const OUT_PATH = path.join(ROOT, 'data/quick-pick-armies.json')

const CARD_ROW_SQL = `SELECT id, name, card_type, rarity, unique_flag, race, uv, move, damage, range_value, toughness,
              company_capacity, company_unit_cap, command_radius, company_ap, ap_generation, cc_generation, favored_terrain,
              primary_type, secondary_type, role, keywords_json, abilities_json, ultimate`

function rowToSnap(row: Record<string, unknown>): CardSnapshot {
  let keywords: string[] = []
  let abilities: string[] = []
  try {
    keywords = JSON.parse(String(row.keywords_json || '[]'))
  } catch {
    keywords = []
  }
  try {
    abilities = JSON.parse(String(row.abilities_json || '[]'))
  } catch {
    abilities = []
  }
  return {
    id: String(row.id),
    name: String(row.name),
    cardType: String(row.card_type),
    rarity: (row.rarity as string | null) ?? 'Common',
    unique: Boolean(row.unique_flag),
    race: (row.race as string | null) ?? null,
    uv: row.uv as number | null,
    move: row.move as number | null,
    damage: row.damage as number | null,
    range: row.range_value as number | null,
    toughness: row.toughness as number | null,
    companyCapacity: row.company_capacity as number | null,
    companyUnitCap: row.company_unit_cap as number | null,
    commandRadius: row.command_radius as number | null,
    companyAp: (row.company_ap as number | null) ?? null,
    apGeneration: (row.ap_generation as number | null) ?? null,
    ccGeneration: (row.cc_generation as number | null) ?? null,
    favoredTerrain: (row.favored_terrain as string | null) ?? null,
    keywords,
    abilities,
    ultimate: (row.ultimate as string | null) ?? null,
    primaryType: (row.primary_type as string | null) ?? null,
    secondaryType: (row.secondary_type as string | null) ?? null,
    role: (row.role as string | null) ?? null,
  }
}

function uvBand(uv: number): 'small' | 'medium' | 'large' {
  if (uv <= 2) return 'small'
  if (uv <= 5) return 'medium'
  return 'large'
}

function officerUnitAffinity(officer: CardSnapshot, unit: CardSnapshot): number {
  let s = 0
  const op = (officer.primaryType || '').toLowerCase()
  const os = (officer.secondaryType || '').toLowerCase()
  const up = (unit.primaryType || '').toLowerCase()
  const us = (unit.secondaryType || '').toLowerCase()
  if (op && (op === up || op === us)) s += 4
  if (os && (os === up || os === us)) s += 2
  const oKeys = new Set((officer.keywords ?? []).map((k) => k.toLowerCase()))
  for (const k of unit.keywords ?? []) {
    if (oKeys.has(k.toLowerCase())) s += 2
  }
  const oRole = String(officer.role || '').toLowerCase()
  const uRole = String(unit.role || '').toLowerCase()
  if (oRole && oRole === uRole) s += 3
  if (oRole === 'artillery' && (up === 'ranged' || (unit.range ?? 1) >= 3)) s += 2
  if (oRole === 'scout' && (up === 'cavalry' || us === 'light' || uRole === 'scout')) s += 2
  if (oRole === 'healer' && (uRole === 'support' || uRole === 'healer')) s += 2
  if (oRole === 'control' && (up === 'magic' || uRole === 'control')) s += 2
  if (oRole === 'frontline' && (up === 'infantry' || us === 'heavy' || uRole === 'frontline')) {
    s += 2
  }
  if (oRole === 'tank' && (us === 'heavy' || uRole === 'tank' || uRole === 'frontline')) s += 2
  if (oRole === 'damage' && (uRole === 'damage' || up === 'infantry' || up === 'ranged')) s += 1
  if (oRole === 'support' && (uRole === 'support' || up === 'infantry')) s += 1
  if ((officer.range ?? 1) >= 2 && (unit.range ?? 1) >= 2) s += 1
  return s
}

function copiesLeft(copyCounts: Map<string, number>, card: CardSnapshot): number {
  return copyLimitForCard(card) - (copyCounts.get(card.id) ?? 0)
}

function takeCopies(
  copyCounts: Map<string, number>,
  card: CardSnapshot,
  n: number,
): number {
  const left = copiesLeft(copyCounts, card)
  const take = Math.max(0, Math.min(n, left))
  if (take > 0) copyCounts.set(card.id, (copyCounts.get(card.id) ?? 0) + take)
  return take
}

function fillCompanyUnits(
  officer: CardSnapshot,
  units: CardSnapshot[],
  copyCounts: Map<string, number>,
  maxCompanyUv: number,
): { units: Array<{ cardId: string; count: number }>; companyUv: number } {
  const officerUv = officer.uv ?? 0
  const unitBudget = Math.min(
    officer.companyCapacity ?? 0,
    Math.max(0, maxCompanyUv - officerUv),
  )
  if (unitBudget <= 0) return { units: [], companyUv: 0 }

  let used = 0
  const entries: Array<{ cardId: string; count: number }> = []
  const unitCap = officer.companyUnitCap ?? 10
  let models = 0
  const wantLarge = unitCap >= 8 ? 2 : 1
  const wantMedium = Math.max(2, Math.ceil(unitCap * 0.4))

  const countInBand = (band: 'small' | 'medium' | 'large') => {
    let n = 0
    for (const e of entries) {
      const card = units.find((u) => u.id === e.cardId)
      if (card && uvBand(card.uv ?? 0) === band) n += e.count
    }
    return n
  }

  // Cohesive mix: match the officer, spend UV on large/medium cores, small as leftover.
  while (used < unitBudget && models < unitCap) {
    const room = unitBudget - used
    const slots = unitCap - models
    const leftover = room <= 3 || slots === 1
    const needLarge = countInBand('large') < wantLarge && room >= 6 && slots >= 3
    const needMedium = !needLarge && countInBand('medium') < wantMedium && room >= 3
    let pick: CardSnapshot | null = null
    let best = -Infinity
    for (const unit of units) {
      const uv = unit.uv ?? 0
      if (uv <= 0 || uv > room) continue
      if (copiesLeft(copyCounts, unit) <= 0) continue
      const band = uvBand(uv)
      const copies = entries.find((e) => e.cardId === unit.id)?.count ?? 0
      let score = officerUnitAffinity(officer, unit) * 3
      if (leftover) {
        score += band === 'small' ? 5 : band === 'medium' ? 2 : -4
      } else if (needLarge) {
        score += band === 'large' ? 7 : band === 'medium' ? 1 : -5
      } else if (needMedium) {
        score += band === 'medium' ? 6 : band === 'large' ? 2 : -3
      } else {
        score += band === 'medium' ? 2 : band === 'large' ? 1.5 : 0
      }
      score -= copies * 1.8
      if (officerUnitAffinity(officer, unit) < 2 && !leftover) score -= 5
      if (score > best) {
        best = score
        pick = unit
      }
    }
    if (!pick) break
    const uv = pick.uv ?? 0
    const existing = entries.find((e) => e.cardId === pick!.id)
    if (existing) existing.count += 1
    else entries.push({ cardId: pick.id, count: 1 })
    takeCopies(copyCounts, pick, 1)
    used += uv
    models += 1
  }

  if (!entries.length) return { units: [], companyUv: 0 }
  return { units: entries, companyUv: officerUv + used }
}

function buildArmyForCommander(
  db: Database.Database,
  commander: CardSnapshot,
): ArmyCompany[] | null {
  const race = commander.race
  if (!race) return null

  const officers = (
    db
      .prepare(
        `${CARD_ROW_SQL}
         FROM cards WHERE card_type = 'Officer' AND race = ? AND company_capacity > 0
         ORDER BY company_capacity DESC, uv ASC`,
      )
      .all(race) as Array<Record<string, unknown>>
  ).map(rowToSnap)

  const units = (
    db
      .prepare(
        `${CARD_ROW_SQL}
         FROM cards WHERE card_type = 'Unit' AND race = ? AND uv > 0
         ORDER BY uv ASC`,
      )
      .all(race) as Array<Record<string, unknown>>
  ).map(rowToSnap)

  if (!officers.length || !units.length) return null

  const copyCounts = new Map<string, number>()
  takeCopies(copyCounts, commander, 1)

  const companies: ArmyCompany[] = []
  let totalUv = commander.uv ?? 0
  const usedOfficerIds = new Set<string>()

  for (const officer of officers) {
    if (usedOfficerIds.has(officer.id)) continue
    if (companies.length >= 6) break
    if (totalUv >= ARMY_UV_MAX - 6) break
    if (copiesLeft(copyCounts, officer) <= 0) continue

    const room = ARMY_UV_MAX - totalUv
    const filled = fillCompanyUnits(officer, units, copyCounts, room)
    if (!filled.units.length) continue

    takeCopies(copyCounts, officer, 1)
    usedOfficerIds.add(officer.id)
    companies.push({ officerCardId: officer.id, units: filled.units })
    totalUv += filled.companyUv
  }

  return companies.length >= 3 ? companies : null
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
const commanders = (
  db
    .prepare(
      `${CARD_ROW_SQL}
       FROM cards WHERE card_type = 'Commander' AND race IS NOT NULL AND uv IS NOT NULL
       ORDER BY race ASC, name ASC`,
    )
    .all() as Array<Record<string, unknown>>
).map(rowToSnap)

const presets: Record<
  string,
  {
    commanderId: string
    commanderName: string
    race: string
    totalUv: number
    companyCount: number
    list: { commander: string; companies: Array<{ officer: string; units: Array<{ name: string; count: number }> }> }
  }
> = {}

let ok = 0
let skipped = 0

for (const commander of commanders) {
  const companies = buildArmyForCommander(db, commander)
  if (!companies) {
    skipped++
    continue
  }

  const cardSnaps = new Map<string, CardSnapshot>()
  cardSnaps.set(commander.id, commander)

  const officerRows = db
    .prepare(
      `${CARD_ROW_SQL} FROM cards WHERE card_type = 'Officer' AND race = ?`,
    )
    .all(commander.race) as Array<Record<string, unknown>>
  const unitRows = db
    .prepare(
      `${CARD_ROW_SQL} FROM cards WHERE card_type = 'Unit' AND race = ?`,
    )
    .all(commander.race) as Array<Record<string, unknown>>
  for (const row of [...officerRows, ...unitRows]) {
    const snap = rowToSnap(row)
    cardSnaps.set(snap.id, snap)
  }

  const army = { commanderCardId: commander.id, companies }
  const resolved = resolveArmy(army, cardSnaps, { enforceCommanderRace: true })
  if (!resolved.ok) {
    skipped++
    continue
  }

  const named = namedListFromArmy(army, cardSnaps)
  if (!named) {
    skipped++
    continue
  }

  presets[commander.id] = {
    commanderId: commander.id,
    commanderName: commander.name,
    race: commander.race ?? '',
    totalUv: resolved.army.totalUv,
    companyCount: companies.length,
    list: named,
  }
  ok++
}

db.close()

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  presets,
}

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8')
console.log(`Wrote ${ok} presets to ${OUT_PATH} (${skipped} skipped)`)
