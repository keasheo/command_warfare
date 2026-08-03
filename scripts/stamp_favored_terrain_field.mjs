#!/usr/bin/env node
/**
 * Stamp favored_terrain field on all cards based on race.
 * Remove terrain flavor keywords from keywords arrays.
 */
import fs from 'node:fs'
import path from 'node:path'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'

const DATA_ROOT = path.resolve(
  process.env.KINGDOMS_DATA ?? 'C:\\Users\\keash\\Projects\\KingdomsBuilder\\data',
)

const RACE_TO_TERRAIN = {
  Human: 'plains',
  Construct: 'plains',
  Beastfolk: 'forest',
  Elf: 'forest',
  Undead: 'swamp',
  Lizardman: 'swamp',
  Dragon: 'volcanic',
  Demon: 'volcanic',
  Dwarf: 'hills',
  // Siege and no race → null / omit
}

const TERRAIN_KEYWORDS = new Set([
  'Open Ground',
  'Woodwalker',
  'Bogstrider',
  'Ashborn',
  'Hillborn',
  'Duneborn',
  'Deepwalker',
])

function processCardsYaml(filePath) {
  const raw = loadYaml(fs.readFileSync(filePath, 'utf8'))
  if (!raw || !raw.cards || !Array.isArray(raw.cards)) {
    return { updated: 0, removed: 0 }
  }

  let updated = 0
  let keywordsRemoved = 0

  for (const card of raw.cards) {
    const race = card.race
    const terrain = RACE_TO_TERRAIN[race] || null

    // Set favored_terrain field
    if (terrain) {
      card.favored_terrain = terrain
      updated++
    } else if (card.favored_terrain !== undefined) {
      // Explicitly remove if no terrain (Siege, etc.)
      delete card.favored_terrain
    }

    // Remove terrain keywords from keywords array
    if (Array.isArray(card.keywords)) {
      const before = card.keywords.length
      card.keywords = card.keywords.filter((kw) => !TERRAIN_KEYWORDS.has(kw))
      const after = card.keywords.length
      keywordsRemoved += before - after
    }
  }

  fs.writeFileSync(filePath, dumpYaml(raw, { lineWidth: 120, noRefs: true }), 'utf8')
  return { updated, removed: keywordsRemoved }
}

function processDirectory(dir) {
  let totalUpdated = 0
  let totalRemoved = 0

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = processDirectory(fullPath)
      totalUpdated += sub.updated
      totalRemoved += sub.removed
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      const { updated, removed } = processCardsYaml(fullPath)
      if (updated > 0 || removed > 0) {
        console.log(
          `${path.relative(DATA_ROOT, fullPath)}: ${updated} cards stamped, ${removed} terrain keywords removed`,
        )
      }
      totalUpdated += updated
      totalRemoved += removed
    }
  }

  return { updated: totalUpdated, removed: totalRemoved }
}

const cardsDir = path.join(DATA_ROOT, 'cards')
console.log(`Stamping favored_terrain field in ${cardsDir}...\n`)

const { updated, removed } = processDirectory(cardsDir)

console.log(
  `\n✓ Done: ${updated} cards stamped with favored_terrain, ${removed} terrain keywords removed`,
)
