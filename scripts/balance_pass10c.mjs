/**
 * Balance pass 10c: final floor pass â€” lift Dwarf / Undead / Beastfolk,
 * trim Lizardman / Dragon overshoot from 10b. balance_rev >= 12.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 12

const changes = []

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

function tuneDwarf(card) {
  let ch = false
  if (card.card_type === 'Commander' && (card.uv || 0) >= 6 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 9 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (
    card.card_type === 'Unit' &&
    (card.rarity || '') === 'Rare' &&
    (card.uv || 0) >= 5 &&
    bump(card, 'uv', -1, 1)
  ) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  }
  return ch
}

function tuneUndead(card) {
  let ch = false
  if (card.card_type === 'Commander' && (card.uv || 0) >= 12 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 9 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (
    card.card_type === 'Unit' &&
    ['Rare', 'Epic'].includes(card.rarity || '') &&
    (card.uv || 0) >= 6 &&
    bump(card, 'uv', -1, 1)
  ) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  }
  return ch
}

function tuneBeastfolk(card) {
  let ch = false
  if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (
    card.card_type === 'Unit' &&
    ['Uncommon', 'Rare'].includes(card.rarity || '') &&
    (card.uv || 0) >= 5 &&
    bump(card, 'uv', -1, 1)
  ) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  }
  return ch
}

function tuneLizardman(card) {
  let ch = false
  if (card.card_type === 'Officer' && (card.uv || 0) >= 9 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (card.card_type === 'Unit' && (card.uv || 0) >= 7 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  } else if (card.card_type === 'Commander' && (card.uv || 0) >= 12 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  }
  return ch
}

function tuneDragon(card) {
  let ch = false
  // Undo pass-10b common-line T bump (overshot to 53%)
  if (
    card.card_type === 'Unit' &&
    (card.balance_rev || 0) === 11 &&
    (card.toughness || 0) >= 3 &&
    bump(card, 'toughness', -1, 2)
  ) {
    ch = true
    log(card, `Tâ†’${card.toughness}`)
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UVâ†’${card.uv}`)
  }
  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  const race = card.race
  if (race === 'Dwarf') ch = tuneDwarf(card)
  else if (race === 'Undead') ch = tuneUndead(card)
  else if (race === 'Beastfolk') ch = tuneBeastfolk(card)
  else if (race === 'Lizardman') ch = tuneLizardman(card)
  else if (race === 'Dragon') ch = tuneDragon(card)
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
console.log('\n=== Summary ===')
for (const race of Object.keys(byRace).sort()) {
  const list = byRace[race]
  console.log(`${race}: ${list.length} changes`)
  for (const c of list) console.log(`  ${c.type} ${c.name}: ${c.note}`)
}
console.log('total', changes.length)
