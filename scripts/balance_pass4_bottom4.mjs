/**
 * Tiny buff pass for bottom-4 win share (Dwarf, Undead, Demon, Elf).
 * Target ~+0.5pp each. Idempotent via balance_rev >= 4.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 4
const FILES = [
  'dwarves/units.yaml',
  'dwarves/officers.yaml',
  'undead/units.yaml',
  'undead/officers.yaml',
]

// Core races live under different folder names
const CORE = [
  ['demons', 'Demon'],
  ['elves', 'Elf'],
]

function bump(card, field, amount, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, card[field] + amount)
  if (next === card[field]) return false
  card[field] = next
  return true
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  const race = card.race
  const type = card.card_type
  let changed = false

  if (type === 'Unit') {
    if (race === 'Dwarf') {
      // Slight punch â€” stats already dense; only low-damage line
      if ((card.damage || 0) <= 3 && bump(card, 'damage', 1, 5)) changed = true
    } else if (race === 'Undead') {
      if ((card.damage || 0) <= 3 && bump(card, 'damage', 1, 5)) changed = true
      if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 6)) changed = true
    } else if (race === 'Demon') {
      if ((card.damage || 0) <= 3 && bump(card, 'damage', 1, 5)) changed = true
    } else if (race === 'Elf') {
      if ((card.toughness || 0) <= 3 && bump(card, 'toughness', 1, 5)) changed = true
      if ((card.range || 1) >= 2 && (card.damage || 0) <= 3 && bump(card, 'damage', 1, 4))
        changed = true
    }
  } else if (type === 'Officer') {
    if (['Dwarf', 'Undead', 'Demon', 'Elf'].includes(race)) {
      if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 6)) changed = true
    }
  }

  if (changed) card.balance_rev = REV
  return changed
}

function processFile(rel) {
  const file = path.join(KB, rel)
  if (!fs.existsSync(file)) {
    console.log('skip missing', rel)
    return
  }
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  let n = 0
  for (const card of doc.cards || []) {
    if (tune(card)) n++
  }
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log(rel, n, 'touched')
}

for (const rel of FILES) processFile(rel)

// Find demon/elf folders
for (const name of fs.readdirSync(KB)) {
  const lower = name.toLowerCase()
  if (lower.includes('demon') || lower === 'demons') {
    processFile(path.join(name, 'units.yaml'))
    processFile(path.join(name, 'officers.yaml'))
  }
  if (lower.includes('elf') || lower === 'elves') {
    processFile(path.join(name, 'units.yaml'))
    processFile(path.join(name, 'officers.yaml'))
  }
}
