/**
 * Balance pass 12b: Dragon floor — melee Reach trim on deployed elites/officers.
 * Pass-12 ranged trims were no-ops (ranged hits Flying without Reach).
 * balance_rev >= 23.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 23

const changes = []

/** Undead — pass-8 melee line not yet trimmed + sim-deployed elites/officer */
const UNDEAD_REACH_TRIM = new Set([
  'Chained Dead',
  'Crypt Guard',
  'Bone Wolves',
  'Grave Diggers',
  'Ancient Wight King',
  'Nightbringer Knights',
  'Death Knight Lead',
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
  if (card.race !== 'Undead') return false
  if (!UNDEAD_REACH_TRIM.has(card.name)) return false
  if ((card.range ?? 1) !== 1) return false
  if (!removeReach(card)) return false
  card.balance_rev = REV
  log(card, `-Reach melee`)
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
console.log('total', changes.length)
for (const c of changes) console.log(`  ${c.type} ${c.name}: ${c.note}`)
