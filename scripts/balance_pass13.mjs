/**
 * Balance pass 13: Dragon / Demon floor lift from pass-12c sim diagnosis.
 * Dragon — weak commanders (Sky Tyrant, Hoard Sovereign), low-kill ranged,
 *   high-death scouts vs Construct/Beastfolk matchups.
 * Demon — weak commanders (Voidclaw, Doomforge), low-hit siege/ranged,
 *   damage deficit vs Beastfolk/Dwarf.
 * Undead untouched. Construct already nerfed in 12c. balance_rev >= 25.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 25

const changes = []

/** Dragon — floor commanders (35–44% win in pass-12c) */
const DRAGON_CMD_UV = new Set(['Sky Tyrant Vexis', 'Hoard Sovereign Khar'])

/** Dragon — core units: scout deaths + low-hit ranged */
const DRAGON_UNIT = {
  'Scale Runners': { toughness: 1 },
  'Ember Chanters': { damage: 1 },
  'Landward Scale Guard': { toughness: 1 },
}

/** Demon — floor commanders */
const DEMON_CMD = {
  'Voidclaw Tormentor': { uv: -1 },
  'Doomforge Tyrant': { toughness: 1 },
}

/** Demon — low-hit deployed cores (Gatebreak 36%, Magma Spitter 37%) */
const DEMON_UNIT = {
  'Gatebreak Engine': { damage: 1, move: 1 },
  'Magma Spitter': { damage: 1 },
}

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

function applyMap(card, map) {
  const spec = map[card.name]
  if (!spec) return false
  let ch = false
  for (const [field, amount] of Object.entries(spec)) {
    const min =
      field === 'toughness' ? 1 : field === 'damage' ? 1 : field === 'move' ? 1 : 1
    const max =
      field === 'toughness' ? 7 : field === 'damage' ? 6 : field === 'move' ? 6 : 99
    const before = card[field]
    if (bump(card, field, amount, min, max)) {
      ch = true
      const label =
        field === 'uv' ? 'UV' : field[0].toUpperCase() + field.slice(1)
      log(card, `${label} ${before}→${card[field]}`)
    }
  }
  return ch
}

function tuneDragon(card) {
  let ch = false
  if (card.card_type === 'Commander' && DRAGON_CMD_UV.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit') {
    ch = applyMap(card, DRAGON_UNIT)
  }
  return ch
}

function tuneDemon(card) {
  let ch = false
  if (card.card_type === 'Commander' && DEMON_CMD[card.name]) {
    ch = applyMap(card, DEMON_CMD)
  } else if (card.card_type === 'Unit') {
    ch = applyMap(card, DEMON_UNIT)
  }
  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  if (card.race === 'Dragon') ch = tuneDragon(card)
  else if (card.race === 'Demon') ch = tuneDemon(card)
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
console.log('\n=== Summary (Dragon / Demon only) ===')
for (const race of Object.keys(byRace).sort()) {
  console.log(`${race}: ${byRace[race].length} changes`)
  for (const c of byRace[race]) console.log(`  ${c.type} ${c.name}: ${c.note}`)
}
console.log('total', changes.length)
