/**
 * Dwarf-only micro buff (prior pass barely touched them â€” damage already high).
 * balance_rev 5
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards/dwarves')
const REV = 5

for (const file of ['units.yaml', 'officers.yaml']) {
  const p = path.join(KB, file)
  const doc = yaml.load(fs.readFileSync(p, 'utf8'))
  let n = 0
  for (const c of doc.cards || []) {
    if ((c.balance_rev || 0) >= REV) continue
    let ch = false
    if (c.card_type === 'Unit' && typeof c.toughness === 'number' && c.toughness <= 5) {
      c.toughness += 1
      ch = true
    }
    if (c.card_type === 'Officer' && typeof c.toughness === 'number' && c.toughness <= 5) {
      c.toughness += 1
      ch = true
    }
    if (ch) {
      c.balance_rev = REV
      n++
    }
  }
  fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log(file, n)
}
