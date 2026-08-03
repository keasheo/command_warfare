/**
 * Balance pass 14: surgical tune after pass-13 overshoot.
 * Dragon 53.1% → ~50% — Sky Tyrant UV restore only (Landward revert overshot).
 * Demon 44.9% → ~49–51% — commander UV floor + unit durability + Hellknight vs Lizard.
 * Undead untouched. balance_rev >= 26.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 26

const changes = []

/** Dragon — partial pass-13 revert (commander UV only; Landward T revert tested −6%) */
const DRAGON_CMD = {
  'Sky Tyrant Vexis': { uv: 1 },
}

/** Demon — floor lift + lizard matchup (34.4% vs Lizardman in pass-13) */
const DEMON_CMD = {
  'Brimstone Herald': { uv: -1 },
  'Ashen Blood Sovereign': { uv: -1 },
}

const DEMON_UNIT = {
  'Scorchfiend Ravager': { toughness: 1 },
  'Hellknight': { toughness: 1 },
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
  if (card.card_type === 'Commander') return applyMap(card, DRAGON_CMD)
  return false
}

function tuneDemon(card) {
  if (card.card_type === 'Commander') return applyMap(card, DEMON_CMD)
  if (card.card_type === 'Unit') return applyMap(card, DEMON_UNIT)
  return false
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
