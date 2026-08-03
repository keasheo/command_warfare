/**
 * One-shot balance pass for expansion races (Undead, Dwarf, Construct, Beastfolk, Dragon).
 * Edits KingdomsBuilder card YAML in place. Re-run: node scripts/balance_expansion_pass.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')

const FILES = [
  'undead/units.yaml',
  'undead/officers.yaml',
  'dwarves/units.yaml',
  'dwarves/officers.yaml',
  'constructs/units.yaml',
  'constructs/officers.yaml',
  'beastfolk/units.yaml',
  'beastfolk/officers.yaml',
  'dragons/units.yaml',
  'dragons/officers.yaml',
]

function bump(card, field, amount, { max = 99, onlyIf = null } = {}) {
  const cur = card[field]
  if (cur == null || typeof cur !== 'number') return false
  if (onlyIf && !onlyIf(cur, card)) return false
  const next = Math.min(max, cur + amount)
  if (next === cur) return false
  card[field] = next
  return true
}

function tune(card) {
  const race = card.race
  const type = card.card_type
  const changes = []

  if (type === 'Unit') {
    if (race === 'Undead') {
      // Close the intentional soft gap without erasing recursion fantasy.
      if (bump(card, 'damage', 1, { max: 4, onlyIf: (d) => d <= 2 })) changes.push('D+1')
      if (bump(card, 'toughness', 1, { max: 5, onlyIf: (t) => t <= 3 })) changes.push('T+1')
      if (bump(card, 'move', 1, { max: 3, onlyIf: (m) => m <= 2 })) changes.push('M+1')
    } else if (race === 'Dwarf') {
      const d0 = card.damage
      if (bump(card, 'damage', 1, { max: 4, onlyIf: (d) => d <= 2 })) changes.push('D+1')
      else if (d0 === 3 && (card.toughness || 0) >= 5) {
        if (bump(card, 'damage', 1, { max: 5 })) changes.push('D+1elite')
      }
      // Slight tempo — still slow vs Human
      if (bump(card, 'move', 1, { max: 3, onlyIf: (m, c) => m === 2 && (c.uv || 0) >= 4 }))
        changes.push('M+1')
    } else if (race === 'Construct') {
      if (bump(card, 'damage', 1, { max: 4, onlyIf: (d) => d <= 2 })) changes.push('D+1')
      if (bump(card, 'move', 1, { max: 3, onlyIf: (m) => m === 2 })) changes.push('M+1')
    } else if (race === 'Beastfolk') {
      const d0 = card.damage
      if (bump(card, 'damage', 1, { max: 4, onlyIf: (d) => d <= 2 })) changes.push('D+1')
      else if (d0 === 3 && (card.uv || 0) >= 5) {
        if (bump(card, 'damage', 1, { max: 5 })) changes.push('D+1elite')
      }
      if (bump(card, 'toughness', 1, { max: 5, onlyIf: (t) => t <= 2 })) changes.push('T+1')
    } else if (race === 'Dragon') {
      // Efficiency was worst — raise punch; keep steep UV curve.
      if (bump(card, 'damage', 1, { max: 5, onlyIf: (d) => d <= 3 })) changes.push('D+1')
      if (bump(card, 'toughness', 1, { max: 7, onlyIf: (t, c) => t <= 3 && (c.uv || 0) >= 4 }))
        changes.push('T+1')
    }
  } else if (type === 'Officer') {
    // Mild officer combat buffs so companies aren't soft bags.
    if (['Undead', 'Dwarf', 'Construct', 'Beastfolk', 'Dragon'].includes(race)) {
      if (bump(card, 'damage', 1, { max: 4, onlyIf: (d) => d > 0 && d <= 2 })) changes.push('offD+1')
      if (race === 'Undead' && bump(card, 'toughness', 1, { max: 5, onlyIf: (t) => t <= 3 }))
        changes.push('offT+1')
      if (
        (race === 'Dwarf' || race === 'Construct') &&
        bump(card, 'toughness', 1, { max: 6, onlyIf: (t) => t <= 4 })
      )
        changes.push('offT+1')
    }
  }

  return changes
}

const summary = {}
for (const rel of FILES) {
  const file = path.join(KB, rel)
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  const cards = doc.cards || []
  let n = 0
  for (const card of cards) {
    const changes = tune(card)
    if (changes.length) {
      n++
      const key = `${card.race}/${card.card_type}`
      summary[key] = (summary[key] || 0) + 1
    }
  }
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log(`wrote ${rel} (${n} cards touched)`)
}
console.log('summary', summary)
