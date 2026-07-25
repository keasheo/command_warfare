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
      abilities_json TEXT NOT NULL DEFAULT '[]',
      ultimate TEXT,
      flavor_text TEXT,
      complexity REAL,
      role TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
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
      tags_json TEXT NOT NULL DEFAULT '[]',
      search_blob TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_abilities_search ON abilities(search_blob);

    CREATE TABLE IF NOT EXISTS documents (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
  `)
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
  command_radius: number | null
  ap_generation: number | null
  cc_generation: number | null
  abilities_json: string
  ultimate: string | null
  flavor_text: string | null
  complexity: number | null
  role: string | null
  tags_json: string
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
    commandRadius: row.command_radius,
    apGeneration: row.ap_generation,
    ccGeneration: row.cc_generation,
    abilities: JSON.parse(row.abilities_json || '[]') as string[],
    ultimate: row.ultimate,
    flavorText: row.flavor_text,
    complexity: row.complexity,
    role: row.role,
    tags: JSON.parse(row.tags_json || '[]') as string[],
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
    tags: JSON.parse(row.tags_json || '[]') as string[],
  }
}
