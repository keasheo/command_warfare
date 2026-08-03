/**
 * Balance pass 10f: Undead-only floor lift (still 45.3% after 10e).
 * balance_rev >= 15.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 15

const changes = []

const UNDEAD_CMD_UV = new Set(['Lord of the Still Host'])
const UNDEAD_OFFICER = {
  'Death Knight Lead': { damage: 1 },
}
const UNDEAD_UNIT = {
  'Pale Bannermen': { uv: -1 },
  'Grave Tyrant': { toughness: 1 },
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
    const min = 1
    const max = field === 'toughness' ? 7 : field === 'damage' ? 6 : 99
    const before = card[field]
    if (bump(card, field, amount, min, max)) {
      ch = true
      const label = field === 'uv' ? 'UV' : field[0].toUpperCase()
      log(card, `${label} ${before}â†’${card[field]}`)
    }
  }
  return ch
}

function tuneUndead(card) {
  if (card.race !== 'Undead') return false
  let ch = false
  if (card.card_type === 'Commander' && UNDEAD_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (card.card_type === 'Officer') ch = applyMap(card, UNDEAD_OFFICER)
  else if (card.card_type === 'Unit') ch = applyMap(card, UNDEAD_UNIT)
  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  const ch = tuneUndead(card)
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

console.log('\n=== Summary ===')
for (const c of changes) console.log(`  ${c.type} ${c.name}: ${c.note}`)
console.log('total', changes.length)
