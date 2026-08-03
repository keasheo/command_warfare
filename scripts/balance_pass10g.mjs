/**
 * Balance pass 10g: final Undead nudge (+0.5pp to floor). balance_rev >= 16.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 16

const changes = []
const UNDEAD_CMD_UV = new Set(['Eclipse Lich Vesper'])
const UNDEAD_UNIT = { 'Screaming Host': { uv: -1 } }

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
  if (card.race !== 'Undead' || (card.balance_rev || 0) >= REV) return false
  let ch = false
  if (card.card_type === 'Commander' && UNDEAD_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit' && UNDEAD_UNIT[card.name] && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
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
for (const c of changes) console.log(c.type, c.name, c.note)
console.log('total', changes.length)
