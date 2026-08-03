/**
 * Soft nerf pass: everyone except Human & Beastfolk.
 * Prefer trimming recent over-buffs (high D/T) â€” balance_rev 6.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 6
const SKIP = new Set(['Human', 'Beastfolk'])

function trim(card, field, amount, min = 1) {
  if (typeof card[field] !== 'number') return false
  const next = Math.max(min, card[field] - amount)
  if (next === card[field]) return false
  card[field] = next
  return true
}

function tune(card) {
  if (SKIP.has(card.race)) return false
  if ((card.balance_rev || 0) >= REV) return false
  if (card.card_type !== 'Unit' && card.card_type !== 'Officer') return false

  let ch = false
  const race = card.race

  if (card.card_type === 'Unit') {
    // Shave peak damage that climbed from prior buffs
    if ((card.damage || 0) >= 5 && trim(card, 'damage', 1, 1)) ch = true
    else if ((card.damage || 0) >= 4 && ['Dragon', 'Dwarf', 'Construct', 'Elf', 'Demon'].includes(race)) {
      if (trim(card, 'damage', 1, 2)) ch = true
    }
    // Soft T trim on the densest lines
    if (['Dwarf', 'Dragon', 'Construct', 'Undead'].includes(race) && (card.toughness || 0) >= 6) {
      if (trim(card, 'toughness', 1, 2)) ch = true
    } else if (race === 'Elf' && (card.toughness || 0) >= 5) {
      if (trim(card, 'toughness', 1, 2)) ch = true
    }
  } else if (card.card_type === 'Officer') {
    if ((card.damage || 0) >= 4 && trim(card, 'damage', 1, 1)) ch = true
    if ((card.toughness || 0) >= 6 && trim(card, 'toughness', 1, 2)) ch = true
  }

  if (ch) card.balance_rev = REV
  return ch
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (name === 'units.yaml' || name === 'officers.yaml') {
      const doc = yaml.load(fs.readFileSync(p, 'utf8'))
      let n = 0
      for (const c of doc.cards || []) if (tune(c)) n++
      fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
      console.log(path.relative(KB, p), n)
    }
  }
}

walk(KB)
