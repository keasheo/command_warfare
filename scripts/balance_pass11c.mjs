/**
 * Balance pass 11c: Human floor â€” +1 T on two more core line units.
 * balance_rev >= 20.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 20

const changes = []
const HUMAN_UNIT = {
  'Column Veterans': { toughness: 1 },
  'Keepguard': { toughness: 1 },
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

function tune(card) {
  if (card.race !== 'Human' || card.card_type !== 'Unit') return false
  if ((card.balance_rev || 0) >= REV) return false
  const spec = HUMAN_UNIT[card.name]
  if (!spec) return false
  let ch = false
  for (const [field, amount] of Object.entries(spec)) {
    const before = card[field]
    if (bump(card, field, amount, 1, 7)) {
      ch = true
      log(card, `T ${before}â†’${card[field]}`)
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
for (const c of changes) console.log(`  ${c.name}: ${c.note}`)
