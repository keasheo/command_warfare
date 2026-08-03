import {
  resolveArmy,
  validateArmyUv,
  type ArmyList,
  type CardLookup,
  type CardSnapshot,
} from './army'
import { ARMY_UV_MAX } from './constants'

export const ARMY_FILE_FORMAT = 'command-warfare-army'
export const ARMY_FILE_VERSION = 2

/** Name-based army list — what we save/share. */
export type NamedArmyUnit = {
  name: string
  count: number
}

export type NamedArmyCompany = {
  officer: string
  units: NamedArmyUnit[]
}

export type NamedArmyList = {
  commander: string
  companies: NamedArmyCompany[]
}

export type ArmyFile = {
  format: typeof ARMY_FILE_FORMAT
  version: number
  name: string
  savedAt: string
  list: NamedArmyList
}

export function buildArmyFileFromNames(
  list: NamedArmyList,
  armyName: string,
): ArmyFile {
  return {
    format: ARMY_FILE_FORMAT,
    version: ARMY_FILE_VERSION,
    name: armyName.trim() || 'Untitled army',
    savedAt: new Date().toISOString(),
    list: {
      commander: list.commander.trim(),
      companies: list.companies.map((co) => ({
        officer: co.officer.trim(),
        units: co.units.map((u) => ({
          name: u.name.trim(),
          count: Math.max(1, Math.floor(u.count)),
        })),
      })),
    },
  }
}

export function namedListFromArmy(
  army: ArmyList,
  cards: CardLookup,
): NamedArmyList | null {
  const commander = cards.get(army.commanderCardId)
  if (!commander) return null
  const companies: NamedArmyCompany[] = []
  for (const co of army.companies) {
    const officer = cards.get(co.officerCardId)
    if (!officer) return null
    const units: NamedArmyUnit[] = []
    for (const u of co.units) {
      const card = cards.get(u.cardId)
      if (!card) return null
      units.push({ name: card.name, count: u.count })
    }
    companies.push({ officer: officer.name, units })
  }
  return { commander: commander.name, companies }
}

function normName(name: string): string {
  return name.trim().toLowerCase()
}

function findByNameAndType(
  name: string,
  cardType: string,
  byName: Map<string, CardSnapshot[]>,
): CardSnapshot | null {
  const hits = byName.get(normName(name)) ?? []
  const typed = hits.filter((c) => c.cardType === cardType)
  if (typed.length === 1) return typed[0]!
  if (typed.length > 1) {
    // Prefer exact case match, else first
    return typed.find((c) => c.name === name) ?? typed[0]!
  }
  return null
}

export function indexCardsByName(cards: Iterable<CardSnapshot>): Map<string, CardSnapshot[]> {
  const map = new Map<string, CardSnapshot[]>()
  for (const c of cards) {
    const key = normName(c.name)
    const list = map.get(key) ?? []
    list.push(c)
    map.set(key, list)
  }
  return map
}

export type ResolveNamedResult =
  | { ok: true; army: ArmyList; totalUv: number }
  | { ok: false; error: string; issues: string[] }

/** Look up cards by name and verify army legality (race, capacity, UV). */
export function resolveNamedArmy(
  list: NamedArmyList,
  cards: CardLookup | Iterable<CardSnapshot>,
  maxUv = ARMY_UV_MAX,
  opts: { enforceCommanderRace?: boolean } = {},
): ResolveNamedResult {
  const enforceRace = opts.enforceCommanderRace !== false
  const cardList: CardSnapshot[] =
    cards instanceof Map ? [...cards.values()] : [...cards]
  const byId: CardLookup = new Map()
  for (const c of cardList) byId.set(c.id, c)
  const byName = indexCardsByName(cardList)
  const issues: string[] = []

  if (!list.commander?.trim()) {
    issues.push('No commander named.')
  }
  if (!list.companies.length) {
    issues.push('Army needs at least one officer company.')
  }

  const commander = list.commander?.trim()
    ? findByNameAndType(list.commander, 'Commander', byName)
    : null
  if (list.commander?.trim() && !commander) {
    issues.push(`Commander not found: “${list.commander.trim()}”.`)
  }

  type BuiltCompany = {
    officer: CardSnapshot | null
    officerName: string
    units: Array<{ card: CardSnapshot; name: string; count: number }>
  }
  const built: BuiltCompany[] = []

  for (let i = 0; i < list.companies.length; i++) {
    const co = list.companies[i]!
    const label = `Company ${i + 1}`
    const officer = findByNameAndType(co.officer, 'Officer', byName)
    if (!officer) {
      issues.push(`${label}: officer not found — “${co.officer}”.`)
    }

    const units: BuiltCompany['units'] = []
    if (!co.units.length) {
      issues.push(`${label}: needs at least one unit.`)
    }
    for (const u of co.units) {
      if (!u.name?.trim() || u.count < 1) continue
      const unit = findByNameAndType(u.name, 'Unit', byName)
      if (!unit) {
        issues.push(`${label}: unit not found — “${u.name}”.`)
        continue
      }
      units.push({ card: unit, name: u.name.trim(), count: Math.floor(u.count) })
    }
    built.push({ officer, officerName: co.officer.trim(), units })
  }

  // Rule checks using whatever we could resolve
  if (commander) {
    for (let i = 0; i < built.length; i++) {
      const co = built[i]!
      const label = `Company ${i + 1}`
      if (co.officer) {
        if (
          enforceRace &&
          commander.race &&
          co.officer.race &&
          co.officer.race !== commander.race
        ) {
          issues.push(
            `${label}: officer “${co.officer.name}” is ${co.officer.race}, commander is ${commander.race}.`,
          )
        }
        const cap = co.officer.companyCapacity ?? 0
        if (cap <= 0) {
          issues.push(`${label}: officer “${co.officer.name}” has no company capacity.`)
        }
        let companyUv = 0
        for (const u of co.units) {
          if (
            enforceRace &&
            commander.race &&
            u.card.race &&
            u.card.race !== commander.race
          ) {
            issues.push(
              `${label}: unit “${u.card.name}” is ${u.card.race}, commander is ${commander.race}.`,
            )
          }
          companyUv += (u.card.uv ?? 0) * u.count
        }
        if (cap > 0 && companyUv > cap) {
          issues.push(
            `${label}: “${co.officer.name}” company UV ${companyUv} exceeds capacity ${cap}.`,
          )
        }
        if (!co.units.length) {
          // already noted if source had no units; if all units missing, say so
          if (list.companies[i]?.units.length) {
            issues.push(`${label}: no valid units resolved for “${co.officer.name}”.`)
          }
        }
      }
    }
  }

  let totalUv = commander?.uv ?? 0
  for (const co of built) {
    totalUv += co.officer?.uv ?? 0
    for (const u of co.units) totalUv += (u.card.uv ?? 0) * u.count
  }
  if (totalUv > maxUv) {
    issues.push(`Army UV ${totalUv} exceeds max ${maxUv}.`)
  }
  if (commander && built.length && totalUv < 1) {
    issues.push('Army UV must be at least 1.')
  }

  if (issues.length) {
    const unique = [...new Set(issues)]
    return {
      ok: false,
      error: `${unique.length} problem${unique.length === 1 ? '' : 's'} found.`,
      issues: unique,
    }
  }

  const army: ArmyList = {
    commanderCardId: commander!.id,
    companies: built.map((co) => ({
      officerCardId: co.officer!.id,
      units: co.units.map((u) => ({ cardId: u.card.id, count: u.count })),
    })),
  }

  // Final safety pass through shared rules
  const resolved = resolveArmy(army, byId, { enforceCommanderRace: enforceRace })
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, issues: [resolved.error] }
  }
  const uv = validateArmyUv(resolved.army, maxUv)
  if (!uv.ok) {
    return { ok: false, error: uv.error, issues: [uv.error] }
  }

  return { ok: true, army, totalUv: resolved.army.totalUv }
}

function parseNamedList(
  raw: unknown,
): { ok: true; list: NamedArmyList } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Army list is missing.' }
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.commander !== 'string' || !obj.commander.trim()) {
    return { ok: false, error: 'Army needs a commander name.' }
  }
  if (!Array.isArray(obj.companies) || !obj.companies.length) {
    return { ok: false, error: 'Army needs companies[].' }
  }
  const companies: NamedArmyCompany[] = []
  for (const co of obj.companies) {
    if (!co || typeof co !== 'object') {
      return { ok: false, error: 'Invalid company entry.' }
    }
    const c = co as Record<string, unknown>
    if (typeof c.officer !== 'string' || !c.officer.trim()) {
      return { ok: false, error: 'Each company needs an officer name.' }
    }
    if (!Array.isArray(c.units)) {
      return { ok: false, error: 'Each company needs units[].' }
    }
    const units: NamedArmyUnit[] = []
    for (const u of c.units) {
      if (!u || typeof u !== 'object') continue
      const unit = u as Record<string, unknown>
      const name =
        typeof unit.name === 'string'
          ? unit.name
          : typeof unit.card === 'string'
            ? unit.card
            : ''
      if (!name.trim()) continue
      const count = typeof unit.count === 'number' ? Math.floor(unit.count) : 1
      if (count < 1) continue
      units.push({ name: name.trim(), count })
    }
    companies.push({ officer: c.officer.trim(), units })
  }
  return {
    ok: true,
    list: { commander: obj.commander.trim(), companies },
  }
}

/** Legacy v1: id-based army + optional labels. */
function namedListFromLegacy(obj: Record<string, unknown>): NamedArmyList | null {
  const labels = obj.labels as
    | {
        commander?: string
        companies?: Array<{
          officer?: string
          units?: Array<{ name?: string; count: number }>
        }>
      }
    | undefined
  if (labels?.commander && Array.isArray(labels.companies)) {
    return {
      commander: labels.commander,
      companies: labels.companies.map((co) => ({
        officer: co.officer ?? '',
        units: (co.units ?? [])
          .filter((u) => u.name)
          .map((u) => ({ name: u.name!, count: u.count })),
      })),
    }
  }
  return null
}

export function parseArmyFile(
  raw: unknown,
): { ok: true; file: ArmyFile } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid army file.' }
  }
  const obj = raw as Record<string, unknown>

  // Bare named list: { commander, companies }
  if (typeof obj.commander === 'string' && Array.isArray(obj.companies) && !obj.format) {
    const list = parseNamedList(obj)
    if (!list.ok) return list
    return { ok: true, file: buildArmyFileFromNames(list.list, 'Imported army') }
  }

  if (obj.format !== ARMY_FILE_FORMAT) {
    return { ok: false, error: 'Not a Command Warfare army file.' }
  }
  if (typeof obj.version !== 'number' || obj.version > ARMY_FILE_VERSION) {
    return { ok: false, error: `Unsupported army file version (${String(obj.version)}).` }
  }

  const armyName =
    typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Imported army'
  const savedAt =
    typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString()

  // v2+ name-based
  if (obj.list) {
    const list = parseNamedList(obj.list)
    if (!list.ok) return list
    return {
      ok: true,
      file: {
        format: ARMY_FILE_FORMAT,
        version: obj.version,
        name: armyName,
        savedAt,
        list: list.list,
      },
    }
  }

  // v1 legacy with labels
  const fromLabels = namedListFromLegacy(obj)
  if (fromLabels?.commander) {
    return {
      ok: true,
      file: {
        format: ARMY_FILE_FORMAT,
        version: ARMY_FILE_VERSION,
        name: armyName,
        savedAt,
        list: fromLabels,
      },
    }
  }

  return {
    ok: false,
    error: 'Army file has no name list. Re-export from the army builder.',
  }
}

export function armyFileBasename(name: string): string {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${safe || 'army'}.cwarmy.json`
}
