/**
 * Second balance nudge: Undead still soft, Dwarf damage lagging.
 * Run once after balance_expansion_pass.mjs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const FILES = ['undead/units.yaml', 'undead/officers.yaml', 'dwarves/units.yaml']

let touched = 0
for (const rel of FILES) {
  const file = path.join(KB, rel)
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  for (const c of doc.cards || []) {
    if (c.race === 'Undead' && c.card_type === 'Unit') {
      if (typeof c.damage === 'number' && c.damage <= 3) {
        c.damage += 1
        touched++
      }
      if (typeof c.toughness === 'number' && c.toughness <= 4) {
        c.toughness += 1
        touched++
      }
    }
    if (c.race === 'Undead' && c.card_type === 'Officer') {
      if (typeof c.damage === 'number' && c.damage > 0 && c.damage <= 3) {
        c.damage += 1
        touched++
      }
      if (typeof c.toughness === 'number' && c.toughness <= 4) {
        c.toughness += 1
        touched++
      }
    }
    if (c.race === 'Dwarf' && c.card_type === 'Unit') {
      if (typeof c.damage === 'number' && c.damage <= 3) {
        c.damage += 1
        touched++
      }
    }
  }
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log('updated', rel)
}
console.log('field bumps', touched)
