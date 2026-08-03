/**
 * Balance pass 12c: Construct-only soft nerf — ranged/siege UV +1, top shooter −1 D.
 * Targets anti-Dragon ranged/siege (Reach trim on melee did little).
 * Undead untouched. balance_rev >= 24.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 24

const changes = []

/** Common / uncommon ranged & siege cores */
const CONSTRUCT_UNIT_UV = new Set([
  'Bolt Throwers',
  'Wire Archers',
  'Siege Brain',
  'Prime Battery Walkers',
  'Walking Battery',
  'Arc Projector',
])

/** Top Piercing+Reach shooter */
const CONSTRUCT_UNIT_NERF = {
  'Coil Rifles': { damage: -1 },
}

/** Light siege officer */
const CONSTRUCT_OFFICER_UV = new Set(['Siege Conductor Bolt'])

function bump(card, field, amount, min = 0, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, Math.max(min, card[field] + amount))
  if (next === card[field]) return false
  card[field] = next
  return true
}

function log(card, note) {
  changes.push({ race: card.race, type: card.card_type, name: card.name, note })
}

function applyUnitMap(card, map) {
  const spec = map[card.name]
  if (!spec) return false
  let ch = false
  for (const [field, amount] of Object.entries(spec)) {
    const min = field === 'damage' ? 1 : 1
    const max = field === 'damage' ? 6 : 99
    const before = card[field]
    if (bump(card, field, amount, min, max)) {
      ch = true
      const label = field === 'uv' ? 'UV' : field[0].toUpperCase() + field.slice(1)
      log(card, `${label} ${before}→${card[field]}`)
    }
  }
  return ch
}

function tuneConstruct(card) {
  if (card.race !== 'Construct') return false
  if ((card.balance_rev || 0) >= REV) return false

  let ch = false
  if (card.card_type === 'Unit' && CONSTRUCT_UNIT_UV.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit') {
    ch = applyUnitMap(card, CONSTRUCT_UNIT_NERF)
  } else if (card.card_type === 'Officer' && CONSTRUCT_OFFICER_UV.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  }

  if (ch) card.balance_rev = REV
  return ch
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (name.endsWith('.yaml') && name !== 'index.yaml') {
      const doc = yaml.load(fs.readFileSync(p, 'utf8'))
      let n = 0
      for (const c of doc.cards || []) if (tuneConstruct(c)) n++
      if (n) {
        fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
        console.log(path.relative(KB, p), n)
      }
    }
  }
}

walk(KB)

console.log('\n=== Summary (Construct only) ===')
for (const c of changes) console.log(`  ${c.type} ${c.name}: ${c.note}`)
console.log('total', changes.length)
