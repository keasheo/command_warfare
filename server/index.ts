/**
 * Command Warfare local API (Express + SQLite).
 */
import cors from 'cors'
import express from 'express'
import { randomUUID } from 'node:crypto'
import {
  abilityFromRow,
  buildAbilitySearchBlob,
  buildCardSearchBlob,
  cardFromRow,
  getDb,
  type AbilityRow,
  type CardRow,
} from './db.ts'
import { importFromKingdoms } from './importYaml.ts'

const PORT = Number(process.env.PORT ?? 8787)
const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

function getSetting<T>(key: string, fallback: T): T {
  const row = getDb()
    .prepare('SELECT value_json FROM settings WHERE key = ?')
    .get(key) as { value_json: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Command Warfare' })
})

app.get('/api/dashboard', (_req, res) => {
  const db = getDb()
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }
  ).n
  const byType = db
    .prepare(
      'SELECT card_type AS label, COUNT(*) AS count FROM cards GROUP BY card_type ORDER BY count DESC',
    )
    .all()
  const byRace = db
    .prepare(
      'SELECT COALESCE(race, "(none)") AS label, COUNT(*) AS count FROM cards GROUP BY race ORDER BY count DESC',
    )
    .all()
  const byRarity = db
    .prepare(
      'SELECT COALESCE(rarity, "(none)") AS label, COUNT(*) AS count FROM cards GROUP BY rarity ORDER BY count DESC',
    )
    .all()
  const abilityCount = (
    db.prepare('SELECT COUNT(*) AS n FROM abilities').get() as { n: number }
  ).n
  const avgUv = (
    db.prepare('SELECT ROUND(AVG(uv), 2) AS avg FROM cards WHERE uv IS NOT NULL').get() as {
      avg: number | null
    }
  ).avg
  res.json({ total, abilityCount, avgUv, byType, byRace, byRarity })
})

app.get('/api/settings', (_req, res) => {
  res.json({
    races: getSetting<string[]>('races', []),
    rarities: getSetting<string[]>('rarities', []),
    roles: getSetting<string[]>('roles', []),
    primaryTypes: getSetting<string[]>('primary_types', []),
    secondaryTypes: getSetting<string[]>('secondary_types', []),
    cardTypes: getSetting<string[]>('card_types', ['Commander', 'Officer', 'Unit']),
  })
})

app.put('/api/settings/races', (req, res) => {
  const races = Array.isArray(req.body?.races)
    ? req.body.races.map(String).filter(Boolean)
    : []
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES ('races', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(JSON.stringify(races))
  res.json({ races })
})

app.get('/api/cards', (req, res) => {
  const q = String(req.query.q ?? '')
    .trim()
    .toLowerCase()
  const type = String(req.query.type ?? '').trim()
  const race = String(req.query.race ?? '').trim()
  const rarity = String(req.query.rarity ?? '').trim()

  const clauses: string[] = []
  const params: unknown[] = []
  if (q) {
    clauses.push('search_blob LIKE ?')
    params.push(`%${q}%`)
  }
  if (type) {
    clauses.push('card_type = ?')
    params.push(type)
  }
  if (race) {
    clauses.push('race = ?')
    params.push(race)
  }
  if (rarity) {
    clauses.push('rarity = ?')
    params.push(rarity)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(
      `SELECT * FROM cards ${where} ORDER BY card_type, name LIMIT 2000`,
    )
    .all(...params) as CardRow[]
  res.json({ cards: rows.map(cardFromRow), total: rows.length })
})

app.get('/api/cards/:id', (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM cards WHERE id = ?')
    .get(req.params.id) as CardRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  res.json({ card: cardFromRow(row) })
})

function upsertCardPayload(body: Record<string, unknown>, id: string) {
  const abilities = Array.isArray(body.abilities) ? body.abilities.map(String) : []
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : []
  const row = {
    id,
    name: String(body.name ?? 'Unnamed'),
    card_type: String(body.cardType ?? body.card_type ?? 'Unit'),
    rarity: (body.rarity as string) ?? null,
    unique_flag: body.unique ? 1 : 0,
    race: (body.race as string) ?? null,
    primary_type: (body.primaryType as string) ?? (body.primary_type as string) ?? null,
    secondary_type:
      (body.secondaryType as string) ?? (body.secondary_type as string) ?? null,
    uv: (body.uv as number) ?? null,
    move: (body.move as number) ?? null,
    damage: (body.damage as number) ?? null,
    range_value: (body.range as number) ?? null,
    toughness: (body.toughness as number) ?? null,
    company_ap: (body.companyAp as number) ?? (body.company_ap as number) ?? null,
    company_capacity:
      (body.companyCapacity as number) ?? (body.company_capacity as number) ?? null,
    command_radius:
      (body.commandRadius as number) ?? (body.command_radius as number) ?? null,
    ap_generation:
      (body.apGeneration as number) ?? (body.ap_generation as number) ?? null,
    cc_generation:
      (body.ccGeneration as number) ?? (body.cc_generation as number) ?? null,
    abilities_json: JSON.stringify(abilities),
    ultimate: (body.ultimate as string) ?? null,
    flavor_text: (body.flavorText as string) ?? (body.flavor_text as string) ?? null,
    complexity: (body.complexity as number) ?? null,
    role: (body.role as string) ?? null,
    tags_json: JSON.stringify(tags),
    search_blob: '',
  }
  row.search_blob = buildCardSearchBlob({
    ...row,
    abilities,
    tags,
    unique: Boolean(row.unique_flag),
  })
  return row
}

app.post('/api/cards', (req, res) => {
  const id = String(req.body?.id ?? randomUUID().replaceAll('-', ''))
  const row = upsertCardPayload(req.body ?? {}, id)
  getDb()
    .prepare(
      `INSERT INTO cards (
        id, name, card_type, rarity, unique_flag, race, primary_type, secondary_type,
        uv, move, damage, range_value, toughness, company_ap, company_capacity,
        command_radius, ap_generation, cc_generation, abilities_json, ultimate,
        flavor_text, complexity, role, tags_json, search_blob
      ) VALUES (
        @id, @name, @card_type, @rarity, @unique_flag, @race, @primary_type, @secondary_type,
        @uv, @move, @damage, @range_value, @toughness, @company_ap, @company_capacity,
        @command_radius, @ap_generation, @cc_generation, @abilities_json, @ultimate,
        @flavor_text, @complexity, @role, @tags_json, @search_blob
      )`,
    )
    .run(row)
  res.status(201).json({ card: cardFromRow(row as CardRow) })
})

app.put('/api/cards/:id', (req, res) => {
  const existing = getDb()
    .prepare('SELECT id FROM cards WHERE id = ?')
    .get(req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  const row = upsertCardPayload(req.body ?? {}, req.params.id)
  getDb()
    .prepare(
      `UPDATE cards SET
        name=@name, card_type=@card_type, rarity=@rarity, unique_flag=@unique_flag,
        race=@race, primary_type=@primary_type, secondary_type=@secondary_type,
        uv=@uv, move=@move, damage=@damage, range_value=@range_value, toughness=@toughness,
        company_ap=@company_ap, company_capacity=@company_capacity,
        command_radius=@command_radius, ap_generation=@ap_generation, cc_generation=@cc_generation,
        abilities_json=@abilities_json, ultimate=@ultimate, flavor_text=@flavor_text,
        complexity=@complexity, role=@role, tags_json=@tags_json, search_blob=@search_blob
      WHERE id=@id`,
    )
    .run(row)
  res.json({ card: cardFromRow(row as CardRow) })
})

app.delete('/api/cards/:id', (req, res) => {
  const result = getDb().prepare('DELETE FROM cards WHERE id = ?').run(req.params.id)
  if (!result.changes) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  res.json({ ok: true })
})

app.get('/api/abilities', (req, res) => {
  const q = String(req.query.q ?? '')
    .trim()
    .toLowerCase()
  const type = String(req.query.type ?? '').trim()
  const clauses: string[] = []
  const params: unknown[] = []
  if (q) {
    clauses.push('search_blob LIKE ?')
    params.push(`%${q}%`)
  }
  if (type && type !== 'All') {
    clauses.push('ability_type = ?')
    params.push(type)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(`SELECT * FROM abilities ${where} ORDER BY name`)
    .all(...params) as AbilityRow[]
  res.json({ abilities: rows.map(abilityFromRow) })
})

app.get('/api/abilities/:name', (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM abilities WHERE name = ?')
    .get(req.params.name) as AbilityRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Ability not found' })
    return
  }
  res.json({ ability: abilityFromRow(row) })
})

app.put('/api/abilities/:name', (req, res) => {
  const body = req.body ?? {}
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : []
  const row = {
    name: req.params.name,
    ability_type: (body.type as string) ?? null,
    cost: (body.cost as string) ?? null,
    cost_amount: (body.costAmount as number) ?? null,
    cost_resource: (body.costResource as string) ?? null,
    description: (body.description as string) ?? null,
    affects: (body.affects as string) ?? null,
    affect_count: (body.affectCount as number) ?? null,
    radius_from: (body.radiusFrom as string) ?? null,
    radius_size: (body.radiusSize as number) ?? null,
    used_by: (body.usedBy as string) ?? null,
    tags_json: JSON.stringify(tags),
    search_blob: '',
  }
  row.search_blob = buildAbilitySearchBlob(row)
  getDb()
    .prepare(
      `INSERT INTO abilities (
        name, ability_type, cost, cost_amount, cost_resource, description,
        affects, affect_count, radius_from, radius_size, used_by, tags_json, search_blob
      ) VALUES (
        @name, @ability_type, @cost, @cost_amount, @cost_resource, @description,
        @affects, @affect_count, @radius_from, @radius_size, @used_by, @tags_json, @search_blob
      )
      ON CONFLICT(name) DO UPDATE SET
        ability_type=excluded.ability_type,
        cost=excluded.cost,
        cost_amount=excluded.cost_amount,
        cost_resource=excluded.cost_resource,
        description=excluded.description,
        affects=excluded.affects,
        affect_count=excluded.affect_count,
        radius_from=excluded.radius_from,
        radius_size=excluded.radius_size,
        used_by=excluded.used_by,
        tags_json=excluded.tags_json,
        search_blob=excluded.search_blob`,
    )
    .run(row)
  res.json({ ability: abilityFromRow(row as AbilityRow) })
})

app.get('/api/docs/:slug', (req, res) => {
  const row = getDb()
    .prepare('SELECT slug, title, body_json FROM documents WHERE slug = ?')
    .get(req.params.slug) as
    | { slug: string; title: string; body_json: string }
    | undefined
  if (!row) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({
    slug: row.slug,
    title: row.title,
    document: JSON.parse(row.body_json),
  })
})

app.post('/api/import', (req, res) => {
  try {
    const source = req.body?.source ? String(req.body.source) : undefined
    const result = importFromKingdoms(source)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

app.listen(PORT, () => {
  getDb()
  const count = (
    getDb().prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }
  ).n
  console.log(`Command Warfare API on http://127.0.0.1:${PORT} (${count} cards)`)
  if (count === 0) {
    console.log('Database empty — POST /api/import or run: npm run import:yaml')
  }
})
