/**
 * Export all card YAML to a single JSON file for Unity or other consumers.
 * Usage: node unity/CommandWarfare/scripts/exportCardsJson.mjs [dataRoot] [outPath]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const dataRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, 'data'))
const outPath = path.resolve(
  process.argv[3] ?? path.join(repoRoot, 'unity/CommandWarfare/Assets/Data/cards.json'),
)

const cards = []
const cardsDir = path.join(dataRoot, 'cards')

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full)
    else if (ent.name.endsWith('.yaml')) {
      const doc = loadYaml(fs.readFileSync(full, 'utf8'))
      for (const c of doc?.cards ?? []) {
        cards.push({ ...c, _source: path.relative(dataRoot, full).replace(/\\/g, '/') })
      }
    }
  }
}

if (!fs.existsSync(cardsDir)) {
  console.error('cards dir not found:', cardsDir)
  process.exit(1)
}

walk(cardsDir)

function toUnityCard(c) {
  return {
    cardId: c.id,
    displayName: c.name,
    cardType: c.card_type,
    race: c.race,
    rarity: c.rarity,
    primaryType: c.primary_type ?? '',
    secondaryType: c.secondary_type ?? '',
    role: c.role ?? '',
    favoredTerrain: c.favored_terrain ?? '',
    uv: c.uv ?? 0,
    move: c.move ?? 0,
    damage: c.damage ?? 0,
    range: c.range ?? 0,
    toughness: c.toughness ?? 0,
    commandRadius: c.command_radius ?? 0,
    companyAp: c.company_ap ?? 0,
    companyCapacity: c.company_capacity ?? 0,
    companyUnitCap: c.company_unit_cap ?? 0,
    apGeneration: c.ap_generation ?? 0,
    ccGeneration: c.cc_generation ?? 0,
    keywords: c.keywords ?? [],
    abilities: c.abilities ?? [],
    ultimate: c.ultimate ?? '',
    flavorText: c.flavor_text ?? '',
    sourceFile: c._source ?? '',
  }
}

const exportedAt = new Date().toISOString()
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify({ cards, exportedAt }, null, 2))
console.log(`Exported ${cards.length} cards → ${outPath}`)

const unityPath = path.join(path.dirname(outPath), 'cards-unity.json')
fs.writeFileSync(unityPath, JSON.stringify({ cards: cards.map(toUnityCard), exportedAt }, null, 2))
console.log(`Exported ${cards.length} Unity cards → ${unityPath}`)
