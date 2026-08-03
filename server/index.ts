/**
 * Command Warfare local API (Express + SQLite).
 */
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { serverLog } from './log.ts'
import {
  artPathFor,
  clearCardArt,
  contentTypeFor,
  hasArt,
  setCardArtFromBuffer,
} from './art.ts'
import {
  abilityFromRow,
  buildAbilitySearchBlob,
  buildCardSearchBlob,
  buildKeywordSearchBlob,
  cardFromRow,
  cardsUsingKeyword,
  getDb,
  keywordFromRow,
  type AbilityRow,
  type CardRow,
  type KeywordRow,
} from './db.ts'
import { importFromKingdoms } from './importYaml.ts'
import { abilityCostsCc, abilityCreatesNewUnit, abilityDisplayRank, abilityUsedByAllowsCard, orderedAbilityNames } from './abilityOrder.ts'
import { MINIMUM_COMMANDER_CC_GENERATION, MINIMUM_COMMANDER_RADIUS, MAXIMUM_COMMANDER_RADIUS, MINIMUM_OFFICER_RADIUS, MAXIMUM_OFFICER_RADIUS, CARD_ART_MAX_BYTES, MAX_CARD_ABILITIES, MAXIMUM_UNIT_PASSIVES, MAXIMUM_ABILITY_DESCRIPTION_LENGTH, maxKeywordsForRarity, countCardAbilitySlots } from './constants.ts'

const PORT = Number(process.env.PORT ?? 8787)
const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CARD_ART_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(png|jpe?g|webp)$/i.test(file.originalname)
    if (!ok) {
      cb(new Error('Unsupported image type. Use png, jpg, jpeg, or webp.'))
      return
    }
    cb(null, true)
  },
})

function serializeCard(row: CardRow) {
  const card = cardFromRow(row)
  const art = hasArt(card.id)
  return {
    ...card,
    hasArt: art,
    artUrl: art ? `/api/cards/${card.id}/art` : null,
  }
}

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
      'SELECT IFNULL(race, ?) AS label, COUNT(*) AS count FROM cards GROUP BY race ORDER BY count DESC',
    )
    .all('(none)')
  const byRarity = db
    .prepare(
      'SELECT IFNULL(rarity, ?) AS label, COUNT(*) AS count FROM cards GROUP BY rarity ORDER BY count DESC',
    )
    .all('(none)')
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
  res.json({ cards: rows.map(serializeCard), total: rows.length })
})

app.get('/api/cards/:id', (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM cards WHERE id = ?')
    .get(req.params.id) as CardRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  res.json({ card: serializeCard(row) })
})

app.get('/api/cards/:id/art', (req, res) => {
  const row = getDb()
    .prepare('SELECT id FROM cards WHERE id = ?')
    .get(req.params.id) as { id: string } | undefined
  if (!row) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  const artPath = artPathFor(row.id)
  if (!artPath) {
    res.status(404).json({ error: 'No art for this card' })
    return
  }
  res.setHeader('Cache-Control', 'no-cache')
  res.type(contentTypeFor(artPath))
  fs.createReadStream(artPath).pipe(res)
})

app.post('/api/cards/:id/art', (req, res) => {
  upload.single('art')(req, res, (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        error:
          uploadError instanceof Error ? uploadError.message : 'Upload failed',
      })
      return
    }
    const row = getDb()
      .prepare('SELECT * FROM cards WHERE id = ?')
      .get(req.params.id) as CardRow | undefined
    if (!row) {
      res.status(404).json({ error: 'Card not found' })
      return
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: 'Missing image file (field name: art)' })
      return
    }
    try {
      setCardArtFromBuffer(row.id, req.file.buffer, req.file.originalname)
      res.json({ card: serializeCard(row) })
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

app.delete('/api/cards/:id/art', (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM cards WHERE id = ?')
    .get(req.params.id) as CardRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  clearCardArt(row.id)
  res.json({ card: serializeCard(row) })
})

function upsertCardPayload(body: Record<string, unknown>, id: string) {
  const rawAbilities = Array.isArray(body.abilities)
    ? body.abilities.map(String).map((name) => name.trim()).filter(Boolean)
    : []
  const abilityRows = getDb()
    .prepare(
      'SELECT name, ability_type, cost, cost_amount, cost_resource, description, used_by FROM abilities',
    )
    .all() as {
    name: string
    ability_type: string | null
    cost: string | null
    cost_amount: number | null
    cost_resource: string | null
    description: string | null
    used_by: string | null
  }[]
  const abilityLibrary = new Map(
    abilityRows.map((row) => [
      row.name,
      {
        name: row.name,
        type: row.ability_type,
        cost: row.cost,
        costAmount: row.cost_amount,
        costResource: row.cost_resource,
        description: row.description,
        usedBy: row.used_by,
      },
    ]),
  )
  const abilities = orderedAbilityNames(rawAbilities, abilityLibrary)
  const rawKeywords = Array.isArray(body.keywords)
    ? body.keywords.map(String).map((name) => name.trim()).filter(Boolean)
    : []
  const seenKw = new Set<string>()
  const keywords: string[] = []
  for (const name of rawKeywords) {
    if (seenKw.has(name)) continue
    seenKw.add(name)
    keywords.push(name)
  }
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : []
  const supportedRaces = Array.isArray(body.supportedRaces)
    ? body.supportedRaces.map(String)
    : Array.isArray(body.supported_races)
      ? body.supported_races.map(String)
      : []
  const supportedTypes = Array.isArray(body.supportedTypes)
    ? body.supportedTypes.map(String)
    : Array.isArray(body.supported_types)
      ? body.supported_types.map(String)
      : []
  const supportedKeywords = Array.isArray(body.supportedKeywords)
    ? body.supportedKeywords.map(String)
    : Array.isArray(body.supported_keywords)
      ? body.supported_keywords.map(String)
      : []
  const ultimate =
    typeof body.ultimate === 'string' && body.ultimate.trim()
      ? body.ultimate.trim()
      : null
  if (countCardAbilitySlots(abilities, ultimate) > MAX_CARD_ABILITIES) {
    throw new Error(
      `Cards can have at most ${MAX_CARD_ABILITIES} abilities (including ultimate).`,
    )
  }
  if (ultimate && abilities.includes(ultimate)) {
    throw new Error(
      `Ultimate '${ultimate}' must not also appear in general abilities.`,
    )
  }
  for (const name of keywords) {
    if (abilities.includes(name) || name === ultimate) {
      throw new Error(`Keyword '${name}' must not also appear as an ability.`)
    }
    if (name === 'Harden' || (name.startsWith('Harden ') && !/^Harden \d+$/.test(name))) {
      throw new Error(`Harden must be printed as 'Harden X' with X ≥ 1 (e.g. Harden 1).`)
    }
    if (/^Harden (\d+)$/.test(name) && Number(name.split(' ')[1]) < 1) {
      throw new Error(`Harden rank must be ≥ 1 (got '${name}').`)
    }
  }
  const rarity = (body.rarity as string) ?? null
  const maxKeywords = maxKeywordsForRarity(rarity)
  if (keywords.length > maxKeywords) {
    throw new Error(
      `${rarity || 'Card'} can have at most ${maxKeywords} keywords (got ${keywords.length}).`,
    )
  }
  const cardType = String(body.cardType ?? body.card_type ?? 'Unit')
  if (cardType !== 'Commander') {
    const ccOnCard = [
      ...abilities.filter((name) => abilityCostsCc(abilityLibrary.get(name))),
      ...(ultimate && abilityCostsCc(abilityLibrary.get(ultimate)) ? [ultimate] : []),
    ]
    if (ccOnCard.length) {
      throw new Error(
        `CC abilities are commander-only (found: ${ccOnCard.join(', ')}).`,
      )
    }
  }
  {
    const spawners = [
      ...abilities.filter((name) => abilityCreatesNewUnit(abilityLibrary.get(name))),
      ...(ultimate && abilityCreatesNewUnit(abilityLibrary.get(ultimate))
        ? [ultimate]
        : []),
    ]
    if (spawners.length) {
      throw new Error(
        `Abilities that create new units are not allowed (found: ${spawners.join(', ')}). Resurrect destroyed units instead.`,
      )
    }
  }
  {
    const wrongTier = abilities.filter((name) => {
      const ab = abilityLibrary.get(name)
      if (!ab) return true
      return !abilityUsedByAllowsCard(
        {
          name: ab.name,
          type: ab.type,
          cost: ab.cost,
          costResource: ab.costResource,
          usedBy: ab.usedBy,
          description: ab.description,
        },
        cardType,
      )
    })
    if (wrongTier.length) {
      throw new Error(
        `Abilities not allowed for ${cardType} (used_by taxonomy): ${wrongTier.join(', ')}.`,
      )
    }
  }
  if (cardType === 'Unit') {
    const passiveCount = abilities.filter(
      (name) => abilityDisplayRank(abilityLibrary.get(name)) === 0,
    ).length
    if (passiveCount > MAXIMUM_UNIT_PASSIVES) {
      throw new Error(
        `Units can have at most ${MAXIMUM_UNIT_PASSIVES} passives (got ${passiveCount}).`,
      )
    }
  }
  const move = (body.move as number) ?? null
  const damage = (body.damage as number) ?? null
  const rangeValue = (body.range as number) ?? null
  const toughness = (body.toughness as number) ?? null
  if (['Unit', 'Officer', 'Commander'].includes(cardType)) {
    const missing: string[] = []
    if (move == null || move <= 0) missing.push('move')
    if (damage == null || damage <= 0) missing.push('damage')
    if (rangeValue == null || rangeValue <= 0) missing.push('range')
    if (toughness == null || toughness <= 0) missing.push('toughness')
    if (missing.length) {
      throw new Error(
        `${cardType} cards require Move, Damage, Range, and Toughness (all > 0). Missing/invalid: ${missing.join(', ')}.`,
      )
    }
  }
  const row = {
    id,
    name: String(body.name ?? 'Unnamed'),
    card_type: cardType,
    rarity,
    unique_flag: body.unique ? 1 : 0,
    race: (body.race as string) ?? null,
    primary_type: (body.primaryType as string) ?? (body.primary_type as string) ?? null,
    secondary_type:
      (body.secondaryType as string) ?? (body.secondary_type as string) ?? null,
    uv: (body.uv as number) ?? null,
    move,
    damage,
    range_value: rangeValue,
    toughness,
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
    keywords_json: JSON.stringify(keywords),
    ultimate,
    flavor_text: (body.flavorText as string) ?? (body.flavor_text as string) ?? null,
    complexity: (body.complexity as number) ?? null,
    role: (body.role as string) ?? null,
    tags_json: JSON.stringify(tags),
    support_json: JSON.stringify({
      races: supportedRaces,
      types: supportedTypes,
      keywords: supportedKeywords,
    }),
    search_blob: '',
  }
  if (row.card_type === 'Commander') {
    const cc = row.cc_generation
    if (cc == null || cc < MINIMUM_COMMANDER_CC_GENERATION) {
      row.cc_generation = MINIMUM_COMMANDER_CC_GENERATION
    }
    const cr = row.command_radius
    if (cr != null && (cr < MINIMUM_COMMANDER_RADIUS || cr > MAXIMUM_COMMANDER_RADIUS)) {
      throw new Error(
        `Commander Command Radius must be ${MINIMUM_COMMANDER_RADIUS}–${MAXIMUM_COMMANDER_RADIUS} (got ${cr}).`,
      )
    }
  }
  if (row.card_type === 'Officer') {
    const cr = row.command_radius
    if (cr != null && (cr < MINIMUM_OFFICER_RADIUS || cr > MAXIMUM_OFFICER_RADIUS)) {
      throw new Error(
        `Officer Command Radius must be ${MINIMUM_OFFICER_RADIUS}–${MAXIMUM_OFFICER_RADIUS} (got ${cr}).`,
      )
    }
  }
  row.search_blob = buildCardSearchBlob({
    ...row,
    abilities,
    keywords,
    tags,
    unique: Boolean(row.unique_flag),
  })
  return row
}

app.post('/api/cards', (req, res) => {
  try {
    const id = String(req.body?.id ?? randomUUID().replaceAll('-', ''))
    const row = upsertCardPayload(req.body ?? {}, id)
    getDb()
      .prepare(
        `INSERT INTO cards (
          id, name, card_type, rarity, unique_flag, race, primary_type, secondary_type,
          uv, move, damage, range_value, toughness, company_ap, company_capacity,
          command_radius, ap_generation, cc_generation, abilities_json, keywords_json, ultimate,
          flavor_text, complexity, role, tags_json, support_json, search_blob
        ) VALUES (
          @id, @name, @card_type, @rarity, @unique_flag, @race, @primary_type, @secondary_type,
          @uv, @move, @damage, @range_value, @toughness, @company_ap, @company_capacity,
          @command_radius, @ap_generation, @cc_generation, @abilities_json, @keywords_json, @ultimate,
          @flavor_text, @complexity, @role, @tags_json, @support_json, @search_blob
        )`,
      )
      .run(row)
    res.status(201).json({ card: serializeCard(row as CardRow) })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

app.put('/api/cards/:id', (req, res) => {
  try {
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
          abilities_json=@abilities_json, keywords_json=@keywords_json, ultimate=@ultimate, flavor_text=@flavor_text,
          complexity=@complexity, role=@role, tags_json=@tags_json, support_json=@support_json,
          search_blob=@search_blob
        WHERE id=@id`,
      )
      .run(row)
    res.json({ card: serializeCard(row as CardRow) })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
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

app.get('/api/keywords', (req, res) => {
  const q = String(req.query.q ?? '')
    .trim()
    .toLowerCase()
  const clauses: string[] = []
  const params: unknown[] = []
  if (q) {
    clauses.push('search_blob LIKE ?')
    params.push(`%${q}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(`SELECT * FROM keywords ${where} ORDER BY name`)
    .all(...params) as KeywordRow[]
  res.json({
    keywords: rows.map((row) => {
      const keyword = keywordFromRow(row)
      const cards = cardsUsingKeyword(keyword.name)
      return { ...keyword, usageCount: cards.length }
    }),
  })
})

app.get('/api/keywords/:name/usage', (req, res) => {
  const name = decodeURIComponent(req.params.name)
  const row = getDb()
    .prepare('SELECT * FROM keywords WHERE name = ?')
    .get(name) as KeywordRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Keyword not found' })
    return
  }
  const cards = cardsUsingKeyword(name)
  res.json({
    keyword: keywordFromRow(row),
    usageCount: cards.length,
    cards,
  })
})

app.put('/api/keywords/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name).trim()
  if (!name) {
    res.status(400).json({ error: 'Keyword name is required.' })
    return
  }
  const body = req.body ?? {}
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : []
  const description = String(body.description ?? '').trim()
  if (!description) {
    res.status(400).json({ error: 'Keyword description is required.' })
    return
  }
  const row = {
    name,
    description,
    tags_json: JSON.stringify(tags),
    search_blob: '',
  }
  row.search_blob = buildKeywordSearchBlob({
    name: row.name,
    description: row.description,
    tags: tags.join(' '),
  })
  getDb()
    .prepare(
      `INSERT INTO keywords (name, description, tags_json, search_blob)
       VALUES (@name, @description, @tags_json, @search_blob)
       ON CONFLICT(name) DO UPDATE SET
         description=excluded.description,
         tags_json=excluded.tags_json,
         search_blob=excluded.search_blob`,
    )
    .run(row)
  const cards = cardsUsingKeyword(name)
  res.json({
    keyword: { ...keywordFromRow(row as KeywordRow), usageCount: cards.length },
  })
})

app.delete('/api/keywords/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name).trim()
  const row = getDb()
    .prepare('SELECT * FROM keywords WHERE name = ?')
    .get(name) as KeywordRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Keyword not found' })
    return
  }
  const cards = cardsUsingKeyword(name)
  if (cards.length > 0) {
    res.status(409).json({
      error: `Cannot delete '${name}' — it is used by ${cards.length} card${cards.length === 1 ? '' : 's'}.`,
      usageCount: cards.length,
      cards,
    })
    return
  }
  getDb().prepare('DELETE FROM keywords WHERE name = ?').run(name)
  res.json({ ok: true, name })
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
  const description = (body.description as string) ?? null
  const normalizedDescription = description
    ? description.replace(/\s+/g, ' ').trim()
    : ''
  if (normalizedDescription.length > MAXIMUM_ABILITY_DESCRIPTION_LENGTH) {
    res.status(400).json({
      error: `Ability description is ${normalizedDescription.length} characters (max ${MAXIMUM_ABILITY_DESCRIPTION_LENGTH}).`,
    })
    return
  }
  if (
    abilityCreatesNewUnit({
      name: req.params.name,
      description: normalizedDescription || description,
    })
  ) {
    res.status(400).json({
      error:
        'Abilities that create new units are not allowed. Resurrect destroyed units instead.',
    })
    return
  }
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : []
  const row = {
    name: req.params.name,
    ability_type: (body.type as string) ?? null,
    cost: (body.cost as string) ?? null,
    cost_amount: (body.costAmount as number) ?? null,
    cost_resource: (body.costResource as string) ?? null,
    description,
    affects: (body.affects as string) ?? null,
    affect_count: (body.affectCount as number) ?? null,
    radius_from: (body.radiusFrom as string) ?? null,
    radius_size: (body.radiusSize as number) ?? null,
    used_by: (body.usedBy as string) ?? null,
    cooldown: (body.cooldown as number) ?? null,
    tags_json: JSON.stringify(tags),
    search_blob: '',
  }
  row.search_blob = buildAbilitySearchBlob(row)
  getDb()
    .prepare(
      `INSERT INTO abilities (
        name, ability_type, cost, cost_amount, cost_resource, description,
        affects, affect_count, radius_from, radius_size, used_by, cooldown, tags_json, search_blob
      ) VALUES (
        @name, @ability_type, @cost, @cost_amount, @cost_resource, @description,
        @affects, @affect_count, @radius_from, @radius_size, @used_by, @cooldown, @tags_json, @search_blob
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
        cooldown=excluded.cooldown,
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
  serverLog('api', `Command Warfare API on http://127.0.0.1:${PORT} (${count} cards)`)
  if (count === 0) {
    serverLog('api', 'Database empty — POST /api/import or run: npm run import:yaml')
  }
})
