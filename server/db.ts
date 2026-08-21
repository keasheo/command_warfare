/**
 * SQLite bootstrap for Command Warfare.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.resolve(__dirname, '..', 'data')
export const DB_PATH = path.join(DATA_DIR, 'command-warfare.sqlite')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      card_type TEXT NOT NULL,
      rarity TEXT,
      unique_flag INTEGER NOT NULL DEFAULT 0,
      race TEXT,
      primary_type TEXT,
      secondary_type TEXT,
      uv REAL,
      move REAL,
      damage REAL,
      range_value REAL,
      toughness REAL,
      company_ap REAL,
      company_capacity REAL,
      command_radius REAL,
      ap_generation REAL,
      cc_generation REAL,
      favored_terrain TEXT,
      abilities_json TEXT NOT NULL DEFAULT '[]',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      ultimate TEXT,
      flavor_text TEXT,
      complexity REAL,
      role TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      support_json TEXT NOT NULL DEFAULT '{}',
      search_blob TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(card_type);
    CREATE INDEX IF NOT EXISTS idx_cards_race ON cards(race);
    CREATE INDEX IF NOT EXISTS idx_cards_search ON cards(search_blob);

    CREATE TABLE IF NOT EXISTS abilities (
      name TEXT PRIMARY KEY,
      ability_type TEXT,
      cost TEXT,
      cost_amount REAL,
      cost_resource TEXT,
      description TEXT,
      affects TEXT,
      affect_count INTEGER,
      radius_from TEXT,
      radius_size REAL,
      used_by TEXT,
      cooldown INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      search_blob TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_abilities_search ON abilities(search_blob);

    CREATE TABLE IF NOT EXISTS keywords (
      name TEXT PRIMARY KEY,
      description TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      search_blob TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_keywords_search ON keywords(search_blob);

    CREATE TABLE IF NOT EXISTS documents (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
  `)
  const cols = database.prepare(`PRAGMA table_info(abilities)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'cooldown')) {
    database.exec(`ALTER TABLE abilities ADD COLUMN cooldown INTEGER`)
  }
  const cardCols = database.prepare(`PRAGMA table_info(cards)`).all() as { name: string }[]
  if (!cardCols.some((c) => c.name === 'support_json')) {
    database.exec(`ALTER TABLE cards ADD COLUMN support_json TEXT NOT NULL DEFAULT '{}'`)
  }
  if (!cardCols.some((c) => c.name === 'keywords_json')) {
    database.exec(`ALTER TABLE cards ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]'`)
  }
  if (!cardCols.some((c) => c.name === 'favored_terrain')) {
    database.exec(`ALTER TABLE cards ADD COLUMN favored_terrain TEXT`)
  }
  if (!cardCols.some((c) => c.name === 'company_unit_cap')) {
    database.exec(`ALTER TABLE cards ADD COLUMN company_unit_cap INTEGER`)
  }
}

export type CardRow = {
  id: string
  name: string
  card_type: string
  rarity: string | null
  unique_flag: number
  race: string | null
  primary_type: string | null
  secondary_type: string | null
  uv: number | null
  move: number | null
  damage: number | null
  range_value: number | null
  toughness: number | null
  company_ap: number | null
  company_capacity: number | null
  company_unit_cap: number | null
  command_radius: number | null
  ap_generation: number | null
  cc_generation: number | null
  favored_terrain: string | null
  abilities_json: string
  keywords_json?: string
  ultimate: string | null
  flavor_text: string | null
  complexity: number | null
  role: string | null
  tags_json: string
  support_json?: string
  search_blob: string
}

export type AbilityRow = {
  name: string
  ability_type: string | null
  cost: string | null
  cost_amount: number | null
  cost_resource: string | null
  description: string | null
  affects: string | null
  affect_count: number | null
  radius_from: string | null
  radius_size: number | null
  used_by: string | null
  cooldown: number | null
  tags_json: string
  search_blob: string
}

export type KeywordRow = {
  name: string
  description: string | null
  tags_json: string
  search_blob: string
}

export function buildCardSearchBlob(card: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(card)) {
    if (value == null || value === '') continue
    if (key === 'search_blob') continue
    if (Array.isArray(value)) {
      parts.push(...value.map(String))
    } else {
      parts.push(String(value))
    }
  }
  return parts.join(' ').toLowerCase()
}

export function buildAbilitySearchBlob(ability: Record<string, unknown>): string {
  return Object.values(ability)
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
}

export function cardFromRow(row: CardRow) {
  const support = JSON.parse(row.support_json || '{}') as {
    races?: string[]
    types?: string[]
    keywords?: string[]
  }
  const abilities = JSON.parse(row.abilities_json || '[]') as string[]
  const keywords = JSON.parse(row.keywords_json || '[]') as string[]
  return {
    id: row.id,
    name: row.name,
    cardType: row.card_type,
    rarity: row.rarity,
    unique: Boolean(row.unique_flag),
    race: row.race,
    primaryType: row.primary_type,
    secondaryType: row.secondary_type,
    uv: row.uv,
    move: row.move,
    damage: row.damage,
    range: row.range_value,
    toughness: row.toughness,
    companyAp: row.company_ap,
    companyCapacity: row.company_capacity,
    companyUnitCap: row.company_unit_cap ?? null,
    commandRadius: row.command_radius,
    apGeneration: row.ap_generation,
    ccGeneration: row.cc_generation,
    favoredTerrain: row.favored_terrain,
    abilities: Array.isArray(abilities) ? abilities : [],
    keywords: Array.isArray(keywords) ? keywords : [],
    ultimate: row.ultimate,
    flavorText: row.flavor_text,
    complexity: row.complexity,
    role: row.role,
    tags: JSON.parse(row.tags_json || '[]') as string[],
    supportedRaces: Array.isArray(support.races) ? support.races : [],
    supportedTypes: Array.isArray(support.types) ? support.types : [],
    supportedKeywords: Array.isArray(support.keywords) ? support.keywords : [],
  }
}

export function abilityFromRow(row: AbilityRow) {
  return {
    name: row.name,
    type: row.ability_type,
    cost: row.cost,
    costAmount: row.cost_amount,
    costResource: row.cost_resource,
    description: row.description,
    affects: row.affects,
    affectCount: row.affect_count,
    radiusFrom: row.radius_from,
    radiusSize: row.radius_size,
    usedBy: row.used_by,
    cooldown: row.cooldown ?? null,
    tags: JSON.parse(row.tags_json || '[]') as string[],
  }
}

export function keywordFromRow(row: KeywordRow) {
  return {
    name: row.name,
    description: row.description,
    tags: JSON.parse(row.tags_json || '[]') as string[],
  }
}

export function buildKeywordSearchBlob(keyword: Record<string, unknown>): string {
  return Object.values(keyword)
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
}

/** Cards that list this keyword in keywords_json (exact or parameterized rank). */
export function cardsUsingKeyword(keywordName: string): {
  id: string
  name: string
  cardType: string
  race: string | null
  rarity: string | null
}[] {
  const name = keywordName.trim()
  if (!name) return []
  const rows = getDb()
    .prepare(
      `SELECT id, name, card_type, race, rarity, keywords_json
       FROM cards
       ORDER BY name`,
    )
    .all() as {
    id: string
    name: string
    card_type: string
    race: string | null
    rarity: string | null
    keywords_json: string
  }[]

  return rows
    .filter((row) => {
      try {
        const keywords = JSON.parse(row.keywords_json || '[]') as unknown
        if (!Array.isArray(keywords)) return false
        return keywords.some((k) => keywordRefMatches(String(k).trim(), name))
      } catch {
        return false
      }
    })
    .map((row) => ({
      id: row.id,
      name: row.name,
      cardType: row.card_type,
      race: row.race,
      rarity: row.rarity,
    }))
}

/** Exact match, or library "Harden" matches printed "Harden 1" / "Harden 2". */
function keywordRefMatches(printed: string, query: string): boolean {
  if (printed === query) return true
  if (query === 'Harden' && /^Harden \d+$/.test(printed)) return true
  if (printed === 'Harden' && /^Harden \d+$/.test(query)) return true
  return false
}
