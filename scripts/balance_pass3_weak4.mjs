/**
 * Balance pass: Dragon, Dwarf, Construct, Beastfolk.
 * Idempotent via balance_rev field on cards (skips if >= 3).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 3
const FILES = [
  'dragons/units.yaml',
  'dragons/officers.yaml',
  'dwarves/units.yaml',
  'dwarves/officers.yaml',
  'constructs/units.yaml',
  'constructs/officers.yaml',
  'beastfolk/units.yaml',
  'beastfolk/officers.yaml',
]

function bump(card, field, amount, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, card[field] + amount)
  if (next === card[field]) return false
  card[field] = next
  return true
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return []
  const race = card.race
  const type = card.card_type
  const changes = []

  if (type === 'Unit') {
    if (race === 'Dragon') {
      if (bump(card, 'damage', 1, 6)) changes.push('D+1')
      if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 8)) changes.push('T+1')
    } else if (race === 'Dwarf') {
      // Stats already strong — tempo + a bit more T for fortify holders
      if ((card.move || 0) <= 2 && bump(card, 'move', 1, 3)) changes.push('M+1')
      if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 7)) changes.push('T+1')
    } else if (race === 'Construct') {
      if ((card.damage || 0) <= 3 && bump(card, 'damage', 1, 5)) changes.push('D+1')
      if ((card.toughness || 0) <= 5 && bump(card, 'toughness', 1, 8)) changes.push('T+1')
    } else if (race === 'Beastfolk') {
      if ((card.damage || 0) <= 3 && bump(card, 'damage', 1, 5)) changes.push('D+1')
      if ((card.toughness || 0) <= 3 && bump(card, 'toughness', 1, 6)) changes.push('T+1')
      if ((card.move || 0) === 3 && bump(card, 'move', 1, 4)) changes.push('M+1')
    }
  } else if (type === 'Officer') {
    if (['Dragon', 'Dwarf', 'Construct', 'Beastfolk'].includes(race)) {
      if ((card.damage || 0) > 0 && (card.damage || 0) <= 3 && bump(card, 'damage', 1, 5))
        changes.push('offD+1')
      if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 7)) changes.push('offT+1')
      if (race === 'Dwarf' && (card.move || 0) <= 2 && bump(card, 'move', 1, 3)) changes.push('offM+1')
      if (race === 'Construct' && (card.move || 0) <= 2 && bump(card, 'move', 1, 3))
        changes.push('offM+1')
    }
  }

  if (changes.length) card.balance_rev = REV
  return changes
}

const summary = {}
for (const rel of FILES) {
  const file = path.join(KB, rel)
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  let n = 0
  for (const card of doc.cards || []) {
    const ch = tune(card)
    if (ch.length) {
      n++
      const key = `${card.race}/${card.card_type}`
      summary[key] = (summary[key] || 0) + 1
    }
  }
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log(rel, n, 'touched')
}
console.log(summary)
