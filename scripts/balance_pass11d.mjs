/**
 * Balance pass 11d: Construct commander UV +1; Dragon core +1 T.
 * balance_rev >= 21.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 21

function bump(card, field, amount, min = 0, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, Math.max(min, card[field] + amount))
  if (next === card[field]) return false
  card[field] = next
  return true
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  if (card.race === 'Construct' && card.name === 'Barrage Mind Helix' && card.card_type === 'Commander') {
    if (!bump(card, 'uv', 1, 1)) return false
    card.balance_rev = REV
    console.log('Barrage Mind Helix UV→', card.uv)
    return true
  }
  if (card.race === 'Dragon' && card.name === 'Brood Skirmishers' && card.card_type === 'Unit') {
    if (!bump(card, 'toughness', 1, 1, 7)) return false
    card.balance_rev = REV
    console.log('Brood Skirmishers T→', card.toughness)
    return true
  }
  return false
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
