/**
 * Balance pass 12: Dragon floor via Reach trim on top Dragon counters.
 * Construct + Undead (68.8% vs Dragon in pass-11 sim) lose selective Reach
 * on pass-8 melee trims (Undead) and excess melee / core ranged (Construct).
 * balance_rev >= 22.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 22

const changes = []

/** Undead — pass-8 melee Reach on core line (range 1) */
const UNDEAD_REACH_TRIM = new Set([
  'Shambling Spears',
  'Skeleton Levy',
  'Zombie Horde',
  'Pale Militia',
])

/** Construct — excess melee Reach + cheap ranged anti-air */
const CONSTRUCT_REACH_TRIM = new Set([
  'Cog Spearmen',
  'Spear Constructs',
  'Bolt Throwers',
  'Wire Archers',
])

function removeReach(card) {
  if (!Array.isArray(card.keywords)) return false
  const idx = card.keywords.indexOf('Reach')
  if (idx === -1) return false
  card.keywords.splice(idx, 1)
  if (card.keywords.length === 0) card.keywords = []
  return true
}

function log(card, note) {
  changes.push({ race: card.race, type: card.card_type, name: card.name, note })
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  if (card.card_type !== 'Unit') return false

  const trim =
    (card.race === 'Undead' && UNDEAD_REACH_TRIM.has(card.name)) ||
    (card.race === 'Construct' && CONSTRUCT_REACH_TRIM.has(card.name))
  if (!trim || !removeReach(card)) return false

  card.balance_rev = REV
  log(card, `-Reach (range ${card.range ?? 1})`)
  return true
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (name.endsWith('.yaml') && name !== 'index.yaml') {
      const doc = yaml.load(fs.readFileSync(p, 'utf8'))
      let n = 0
      for (const c of doc.cards || []) if (tune(c)) n++
      if (n) {
        fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
        console.log(path.relative(KB, p), n)
      }
    }
  }
}

walk(KB)

const byRace = {}
for (const c of changes) {
  if (!byRace[c.race]) byRace[c.race] = []
  byRace[c.race].push(c)
}
console.log('\n=== Summary ===')
for (const race of Object.keys(byRace).sort()) {
  console.log(`${race}: ${byRace[race].length} cards`)
  for (const c of byRace[race]) console.log(`  ${c.name}: ${c.note}`)
}
console.log('total', changes.length)
