/**
 * Import game YAML data (cards, abilities, keywords, docs) into SQLite.
 * Default source: repo `data/` (override with KINGDOMS_DATA).
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import {
  buildAbilitySearchBlob,
  buildCardSearchBlob,
  getDb,
} from './db.ts'
import { copyArtIfPresent } from './art.ts'
import { orderedAbilityNames, abilityCreatesNewUnit, abilityUsedByAllowsCard, isUltimateAbilityLike } from './abilityOrder.ts'
import { MINIMUM_COMMANDER_CC_GENERATION } from './constants.ts'

const DEFAULT_SOURCE = path.resolve(
  process.env.KINGDOMS_DATA ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'),
)

function readYamlFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null
  return loadYaml(fs.readFileSync(filePath, 'utf8'))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function importFromKingdoms(sourceRoot = DEFAULT_SOURCE): {
  cards: number
  abilities: number
  keywords: number
  documents: number
  source: string
} {
  const db = getDb()

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source data not found: ${sourceRoot}`)
  }

  const cardsDir = path.join(sourceRoot, 'cards')
  const abilitiesPath = path.join(sourceRoot, 'abilities.yaml')
  const keywordsPath = path.join(sourceRoot, 'keywords.yaml')
  const settingsPath = path.join(sourceRoot, 'settings.yaml')
  const docsDir = path.join(sourceRoot, 'docs')

  const run = db.transaction(() => {
    db.exec(
      'DELETE FROM cards; DELETE FROM abilities; DELETE FROM keywords; DELETE FROM documents; DELETE FROM settings;',
    )

    const settings = asRecord(readYamlFile(settingsPath))
    const insertSetting = db.prepare(
      'INSERT INTO settings (key, value_json) VALUES (?, ?)',
    )
    for (const [key, value] of Object.entries(settings)) {
      insertSetting.run(key, JSON.stringify(value ?? null))
    }

    const abilitiesRaw = asRecord(readYamlFile(abilitiesPath))
    let abilityCount = 0
    const abilityLibrary = new Map<
      string,
      {
        name: string
        type: string | null
        cost: string | null
        costResource: string | null
        costAmount: number | null
        description: string | null
        usedBy: string | null
      }
    >()
    const insertAbility = db.prepare(`
      INSERT INTO abilities (
        name, ability_type, cost, cost_amount, cost_resource, description,
        affects, affect_count, radius_from, radius_size, used_by, cooldown, tags_json, search_blob
      ) VALUES (
        @name, @ability_type, @cost, @cost_amount, @cost_resource, @description,
        @affects, @affect_count, @radius_from, @radius_size, @used_by, @cooldown, @tags_json, @search_blob
      )
    `)
    for (const [name, raw] of Object.entries(abilitiesRaw)) {
      const a = asRecord(raw)
      const tags = Array.isArray(a.tags) ? a.tags : []
      const row = {
        name,
        ability_type: (a.type as string) ?? null,
        cost: (a.cost as string) ?? null,
        cost_amount: (a.cost_amount as number) ?? null,
        cost_resource: (a.cost_resource as string) ?? null,
        description: (a.description as string) ?? null,
        affects: (a.affects as string) ?? null,
        affect_count: (a.affect_count as number) ?? null,
        radius_from: (a.radius_from as string) ?? null,
        radius_size: (a.radius_size as number) ?? null,
        used_by: (a.used_by as string) ?? null,
        cooldown: (a.cooldown as number) ?? null,
        tags_json: JSON.stringify(tags),
        search_blob: '',
      }
      if (
        abilityCreatesNewUnit({ name, description: row.description }) &&
        !isUltimateAbilityLike({ type: row.ability_type, cost: row.cost })
      ) {
        console.warn(
          `Skipping ability '${name}' — creates new units (resurrect-only policy).`,
        )
        continue
      }
      row.search_blob = buildAbilitySearchBlob(row)
      insertAbility.run(row)
      abilityLibrary.set(name, {
        name,
        type: row.ability_type,
        cost: row.cost,
        costResource: row.cost_resource,
        costAmount: row.cost_amount,
        description: row.description,
        usedBy: row.used_by,
      })
      abilityCount += 1
    }

    const keywordsRaw = asRecord(readYamlFile(keywordsPath))
    let keywordCount = 0
    const insertKeyword = db.prepare(`
      INSERT INTO keywords (name, description, tags_json, search_blob)
      VALUES (@name, @description, @tags_json, @search_blob)
    `)
    for (const [name, raw] of Object.entries(keywordsRaw)) {
      const k = asRecord(raw)
      const tags = Array.isArray(k.tags) ? k.tags : []
      const description = String(k.description ?? '').trim()
      if (!description) {
        console.warn(`Skipping keyword '${name}' — missing description.`)
        continue
      }
      const row = {
        name,
        description,
        tags_json: JSON.stringify(tags),
        search_blob: '',
      }
      row.search_blob = buildAbilitySearchBlob(row)
      insertKeyword.run(row)
      keywordCount += 1
    }

    const insertCard = db.prepare(`
      INSERT INTO cards (
        id, name, card_type, rarity, unique_flag, race, primary_type, secondary_type,
        uv, move, damage, range_value, toughness, company_ap, company_capacity, company_unit_cap,
        command_radius, ap_generation, cc_generation, favored_terrain, abilities_json, keywords_json, ultimate,
        flavor_text, complexity, role, tags_json, support_json, search_blob
      ) VALUES (
        @id, @name, @card_type, @rarity, @unique_flag, @race, @primary_type, @secondary_type,
        @uv, @move, @damage, @range_value, @toughness, @company_ap, @company_capacity, @company_unit_cap,
        @command_radius, @ap_generation, @cc_generation, @favored_terrain, @abilities_json, @keywords_json, @ultimate,
        @flavor_text, @complexity, @role, @tags_json, @support_json, @search_blob
      )
    `)

    let cardCount = 0
    if (fs.existsSync(cardsDir)) {
      for (const raceDir of fs.readdirSync(cardsDir)) {
        const racePath = path.join(cardsDir, raceDir)
        if (!fs.statSync(racePath).isDirectory()) continue
        for (const file of fs.readdirSync(racePath)) {
          if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
          const payload = asRecord(readYamlFile(path.join(racePath, file)))
          const cards = Array.isArray(payload.cards) ? payload.cards : []
          for (const raw of cards) {
            const c = asRecord(raw)
            const abilities = orderedAbilityNames(
              (Array.isArray(c.abilities) ? c.abilities : []).map(String),
              abilityLibrary,
            ).filter((name) => {
              const ab = abilityLibrary.get(name)
              if (!ab) return false
              return abilityUsedByAllowsCard(ab, String(c.card_type ?? 'Unit'))
            })
            let ultimate = (c.ultimate as string) ?? null
            if (ultimate && abilityCreatesNewUnit(abilityLibrary.get(ultimate))) {
              ultimate = null
            }
            if (
              ultimate &&
              String(c.card_type ?? 'Unit') !== 'Commander'
            ) {
              ultimate = null
            }
            const keywords = uniqueNames(
              (Array.isArray(c.keywords) ? c.keywords : []).map(String),
            )
            const tags = Array.isArray(c.tags) ? c.tags : []
            const row = {
              id: String(c.id ?? randomUUID().replaceAll('-', '')),
              name: String(c.name ?? 'Unnamed'),
              card_type: String(c.card_type ?? 'Unit'),
              rarity: (c.rarity as string) ?? null,
              unique_flag: c.unique ? 1 : 0,
              race: (c.race as string) ?? null,
              primary_type: (c.primary_type as string) ?? null,
              secondary_type: (c.secondary_type as string) ?? null,
              uv: (c.uv as number) ?? null,
              move: (c.move as number) ?? null,
              damage: (c.damage as number) ?? null,
              range_value: (c.range as number) ?? null,
              toughness: (c.toughness as number) ?? null,
              company_ap: (c.company_ap as number) ?? null,
              company_capacity: (c.company_capacity as number) ?? null,
              company_unit_cap: (c.company_unit_cap as number) ?? null,
              command_radius: (c.command_radius as number) ?? null,
              ap_generation: (c.ap_generation as number) ?? null,
              cc_generation: (c.cc_generation as number) ?? null,
              favored_terrain: (c.favored_terrain as string) ?? null,
              abilities_json: JSON.stringify(abilities),
              keywords_json: JSON.stringify(keywords),
              ultimate,
              flavor_text: (c.flavor_text as string) ?? null,
              complexity: (c.complexity as number) ?? null,
              role: (c.role as string) ?? null,
              tags_json: JSON.stringify(tags),
              support_json: JSON.stringify({
                races: Array.isArray(c.supported_races) ? c.supported_races : [],
                types: Array.isArray(c.supported_types) ? c.supported_types : [],
                keywords: Array.isArray(c.supported_keywords) ? c.supported_keywords : [],
              }),
              search_blob: '',
            }
            if (
              row.card_type === 'Commander' &&
              (row.cc_generation == null ||
                row.cc_generation < MINIMUM_COMMANDER_CC_GENERATION)
            ) {
              row.cc_generation = MINIMUM_COMMANDER_CC_GENERATION
            }
            row.search_blob = buildCardSearchBlob({
              ...row,
              abilities,
              keywords,
              tags,
              unique: Boolean(row.unique_flag),
            })
            insertCard.run(row)
            copyArtIfPresent(row.id, path.join(sourceRoot, 'art'))
            cardCount += 1
          }
        }
      }
    }

    let docCount = 0
    const insertDoc = db.prepare(
      'INSERT INTO documents (slug, title, body_json) VALUES (?, ?, ?)',
    )
    for (const slug of ['rulebook', 'design_bible']) {
      const docPath = path.join(docsDir, `${slug}.yaml`)
      const raw = asRecord(readYamlFile(docPath))
      if (!Object.keys(raw).length) continue
      insertDoc.run(slug, String(raw.title ?? slug), JSON.stringify(raw))
      docCount += 1
    }

    return {
      cards: cardCount,
      abilities: abilityCount,
      keywords: keywordCount,
      documents: docCount,
    }
  })

  const counts = run()
  return { ...counts, source: sourceRoot }
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])

if (isDirectRun) {
  const result = importFromKingdoms()
  console.log(
    `Imported ${result.cards} cards, ${result.abilities} abilities, ${result.keywords} keywords, ${result.documents} docs from ${result.source}`,
  )
}
