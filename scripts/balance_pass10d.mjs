/**
 * Balance pass 10d: revert Beastfolk 10c overshoot; lift Demon + Undead floor.
 * balance_rev >= 13.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 13

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

function tuneBeastfolk(card) {
  // Revert pass-10c UV trim (restored deploy = runaway)
  if ((card.balance_rev || 0) !== 12) return false
  let ch = false
  const before = card.uv
  if (bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UV ${before}→${card.uv} (revert 10c)`)
  }
  return ch
}

function tuneDemon(card) {
  let ch = false
  // Undo pass-10/10b officer+unit UV bumps
  if ((card.balance_rev || 0) >= 10 && (card.balance_rev || 0) <= 11) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit' && (card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
    ch = true
    log(card, `T→${card.toughness}`)
  }
  return ch
}

function tuneUndead(card) {
  let ch = false
  if (card.card_type === 'Unit' && (card.damage || 0) <= 3 && bump(card, 'damage', 1, 1, 5)) {
    ch = true
    log(card, `D→${card.damage}`)
  } else if (card.card_type === 'Officer' && (card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
    ch = true
    log(card, `T→${card.toughness}`)
  }
  return ch
}

function tuneLizardman(card) {
  let ch = false
  if (card.card_type === 'Commander' && (card.uv || 0) >= 12 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  }
  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  const race = card.race
  if (race === 'Beastfolk') ch = tuneBeastfolk(card)
  else if (race === 'Demon') ch = tuneDemon(card)
  else if (race === 'Undead') ch = tuneUndead(card)
  else if (race === 'Lizardman') ch = tuneLizardman(card)
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
  for (const c of list.slice(0, 15)) console.log(`  ${c.type} ${c.name}: ${c.note}`)
  if (list.length > 15) console.log(`  ... +${list.length - 15} more`)
}
console.log('total', changes.length)
