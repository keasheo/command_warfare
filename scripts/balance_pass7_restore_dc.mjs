/**
 * Micro-restore Dwarf + Construct after soft-nerf overshot. balance_rev 7.
 * Does not touch Human / Beastfolk.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 7
const TARGET = new Set(['Dwarf', 'Construct'])

function bump(card, field, amount, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, card[field] + amount)
  if (next === card[field]) return false
  card[field] = next
  return true
}

for (const folder of ['dwarves', 'constructs']) {
  for (const file of ['units.yaml', 'officers.yaml']) {
    const p = path.join(KB, folder, file)
    const doc = yaml.load(fs.readFileSync(p, 'utf8'))
    let n = 0
    for (const c of doc.cards || []) {
      if (!TARGET.has(c.race)) continue
      if ((c.balance_rev || 0) >= REV) continue
      let ch = false
      if (c.card_type === 'Unit') {
        if ((c.damage || 0) <= 3 && bump(c, 'damage', 1, 4)) ch = true
        if ((c.toughness || 0) <= 4 && bump(c, 'toughness', 1, 6)) ch = true
      } else if (c.card_type === 'Officer') {
        if ((c.toughness || 0) <= 4 && bump(c, 'toughness', 1, 6)) ch = true
      }
      if (ch) {
        c.balance_rev = REV
        n++
      }
    }
    fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
    console.log(folder + '/' + file, n)
  }
}
