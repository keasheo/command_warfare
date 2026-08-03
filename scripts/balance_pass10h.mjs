/**
 * Balance pass 10h: Elf floor 48.5%.
 * Revert pass-10g Undead UV trims (Screaming Host + Eclipse Lich Vesper);
 * Lord of the Still Host UV -1 to hold Undead floor after revert.
 * balance_rev >= 17.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 17

const changes = []

const UNDEAD_REVERT_10G = {
  'Screaming Host': 'Unit',
  'Eclipse Lich Vesper': 'Commander',
}
const UNDEAD_CMD_UV = new Set(['Lord of the Still Host'])

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

function revertPass10g(card) {
  if (card.race !== 'Undead' || (card.balance_rev || 0) !== 16) return false
  const type = UNDEAD_REVERT_10G[card.name]
  if (!type || card.card_type !== type) return false
  const before = card.uv
  if (!bump(card, 'uv', 1, 1)) return false
  card.balance_rev = REV
  log(card, `UV ${before}→${card.uv} (revert 10g)`)
  return true
}

function tuneUndeadFloor(card) {
  if (card.race !== 'Undead' || card.card_type !== 'Commander') return false
  if (!UNDEAD_CMD_UV.has(card.name) || (card.balance_rev || 0) >= REV) return false
  const before = card.uv
  if (!bump(card, 'uv', -1, 1)) return false
  card.balance_rev = REV
  log(card, `UV ${before}→${card.uv}`)
  return true
}

function tune(card) {
  if (revertPass10g(card)) return true
  return tuneUndeadFloor(card)
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

console.log('\n=== Summary ===')
for (const c of changes) console.log(`  ${c.type} ${c.name}: ${c.note}`)
console.log('total', changes.length)
